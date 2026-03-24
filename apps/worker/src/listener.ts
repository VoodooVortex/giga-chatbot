import type { PoolClient } from "pg";
import type { RagUpdateEvent, EmbeddingJob } from "./types";
import { getListenClient } from "./db";
import {
    DebouncedQueue,
    logWorkerEvent,
    timeAsync,
    workerMetrics,
    type WorkerMetricsSnapshot,
} from "./queue";
import { processRecord } from "./embedder";
import { fetchRecordData, deleteEmbedding, upsertEmbedding } from "./db";

/**
 * RAG Update Listener
 * 
 * Listens for PostgreSQL NOTIFY events on the 'rag_update' channel
 * and processes them through the debounced queue.
 */
export class RagUpdateListener {
    private client: PoolClient | null = null;
    private queue: DebouncedQueue;
    private isRunning: boolean = false;

    constructor() {
        // Create queue with processing function
        this.queue = new DebouncedQueue(this.processJobs.bind(this));
    }

    /**
     * Start listening for RAG update events
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logWorkerEvent("warn", "listener.already_running", {});
            return;
        }

        logWorkerEvent("info", "listener.starting", {});

        try {
            // Get dedicated client for LISTEN
            this.client = await getListenClient();

            // Listen for notifications
            this.client.on("notification", (msg) => {
                if (msg.channel === "rag_update" && msg.payload) {
                    this.handleNotification(msg.payload);
                }
            });

            // Subscribe to rag_update channel
            await this.client.query("LISTEN rag_update");

            this.isRunning = true;
            logWorkerEvent("info", "listener.started", {
                channel: "rag_update",
            });
        } catch (error) {
            logWorkerEvent("error", "listener.start_failed", {
                error: error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    }
                    : { value: error },
            });
            throw error;
        }
    }

    /**
     * Handle incoming notification
     */
    private handleNotification(payload: string): void {
        try {
            const event: RagUpdateEvent = JSON.parse(payload);
            workerMetrics.increment("listener.notifications_received");
            logWorkerEvent("info", "listener.notification_received", {
                table: event.table,
                pk: event.pk,
                action: event.action,
            });

            // Add to queue for debounced processing
            this.queue.add(event);
        } catch (error) {
            workerMetrics.increment("listener.notification_parse_failures");
            logWorkerEvent("error", "listener.notification_parse_failed", {
                error: error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    }
                    : { value: error },
                payloadPreview: payload.slice(0, 200),
            });
        }
    }

    /**
     * Process a batch of jobs
     */
    private async processJobs(jobs: EmbeddingJob[]): Promise<void> {
        const batchStartedAt = Date.now();
        workerMetrics.increment("listener.batches_started");
        workerMetrics.observe("listener.batch_size", jobs.length);

        const deleteJobs = jobs.filter((j) => j.action === "DELETE");
        const otherJobs = jobs.filter((j) => j.action !== "DELETE");

        logWorkerEvent("info", "listener.batch_started", {
            jobCount: jobs.length,
            deleteCount: deleteJobs.length,
            updateCount: otherJobs.length,
        });

        try {
            for (const job of deleteJobs) {
                try {
                    workerMetrics.increment("listener.delete_jobs_started");
                    await timeAsync("listener.delete_embedding_ms", () =>
                        deleteEmbedding(job.table, job.pk),
                    );
                    workerMetrics.increment("listener.delete_jobs_succeeded");
                    workerMetrics.increment("listener.jobs_completed");
                    logWorkerEvent("info", "listener.embedding_deleted", {
                        table: job.table,
                        pk: job.pk,
                    });
                } catch (error) {
                    workerMetrics.increment("listener.delete_jobs_failed");
                    logWorkerEvent("error", "listener.embedding_delete_failed", {
                        table: job.table,
                        pk: job.pk,
                        error: error instanceof Error
                            ? {
                                name: error.name,
                                message: error.message,
                                stack: error.stack,
                            }
                            : { value: error },
                    });
                    throw error;
                }
            }

            for (const job of otherJobs) {
                try {
                    await this.processJob(job);
                } catch (error) {
                    workerMetrics.increment("listener.update_jobs_failed");
                    logWorkerEvent("error", "listener.job_failed", {
                        jobId: job.id,
                        table: job.table,
                        pk: job.pk,
                        error: error instanceof Error
                            ? {
                                name: error.name,
                                message: error.message,
                                stack: error.stack,
                            }
                            : { value: error },
                    });
                    throw error;
                }
            }

            workerMetrics.increment("listener.batches_succeeded");
            logWorkerEvent("info", "listener.batch_completed", {
                jobCount: jobs.length,
                durationMs: Date.now() - batchStartedAt,
            });
        } finally {
            workerMetrics.observe("listener.batch_ms", Date.now() - batchStartedAt);
        }
    }

    /**
     * Process a single job
     */
    private async processJob(job: EmbeddingJob): Promise<void> {
        const startedAt = Date.now();
        workerMetrics.increment("listener.jobs_started");
        logWorkerEvent("debug", "listener.job_started", {
            jobId: job.id,
            table: job.table,
            pk: job.pk,
            action: job.action,
            retryCount: job.retryCount,
        });

        let completed = false;

        try {
            // Fetch record data from database
            const recordData = await timeAsync("listener.fetch_record_ms", () =>
                fetchRecordData(job.table, job.pk),
            );

            if (!recordData) {
                workerMetrics.increment("listener.records_missing");
                logWorkerEvent("warn", "listener.record_missing", {
                    jobId: job.id,
                    table: job.table,
                    pk: job.pk,
                });
                // If record doesn't exist, delete any existing embedding
                await timeAsync("listener.delete_missing_record_ms", () =>
                    deleteEmbedding(job.table, job.pk),
                );
                workerMetrics.increment("listener.records_missing_deleted");
                workerMetrics.increment("listener.jobs_completed_without_upsert");
                workerMetrics.increment("listener.jobs_completed");
                completed = true;
                return;
            }

            // Generate embeddings
            const embeddingResults = await timeAsync("listener.process_record_ms", () =>
                processRecord(recordData),
            );
            workerMetrics.observe("listener.record_chunk_count", embeddingResults.length);

            if (embeddingResults.length === 0) {
                workerMetrics.increment("listener.zero_embedding_results");
                logWorkerEvent("warn", "listener.record_produced_no_embeddings", {
                    jobId: job.id,
                    table: job.table,
                    pk: job.pk,
                });
                workerMetrics.increment("listener.jobs_completed_without_upsert");
                workerMetrics.increment("listener.jobs_completed");
                completed = true;
                return;
            }

            // For simplicity, we use the first chunk's embedding
            // In production, you might want to store all chunks
            const result = embeddingResults[0];

            // Upsert to database
            await timeAsync("listener.upsert_embedding_ms", () =>
                upsertEmbedding(
                    result.sourceTable,
                    result.sourcePk,
                    result.content,
                    result.embedding,
                    result.sourceUpdatedAt,
                ),
            );

            workerMetrics.increment("listener.jobs_succeeded");
            workerMetrics.increment("listener.jobs_completed");
            completed = true;
            logWorkerEvent("info", "listener.job_completed", {
                jobId: job.id,
                table: job.table,
                pk: job.pk,
                chunkCount: embeddingResults.length,
                durationMs: Date.now() - startedAt,
            });
        } finally {
            workerMetrics.observe("listener.job_ms", Date.now() - startedAt);
            if (!completed) {
                workerMetrics.increment("listener.jobs_failed");
            }
        }
    }

    /**
     * Stop the listener
     */
    async stop(): Promise<void> {
        logWorkerEvent("info", "listener.stopping", {});

        this.isRunning = false;

        // Stop the queue
        await this.queue.stop();

        // Release client
        if (this.client) {
            await this.client.query("UNLISTEN rag_update");
            this.client.release();
            this.client = null;
        }

        logWorkerEvent("info", "listener.stopped", {});
    }

    /**
     * Get current stats
     */
    getStats(): {
        isRunning: boolean;
        queueStats: { pending: number; isProcessing: boolean; metrics: WorkerMetricsSnapshot };
    } {
        return {
            isRunning: this.isRunning,
            queueStats: this.queue.getStats(),
        };
    }
}
