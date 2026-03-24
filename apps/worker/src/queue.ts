import type { EmbeddingJob, RagUpdateEvent } from "./types";
import { env } from "./config";

type LogLevel = "debug" | "info" | "warn" | "error";

interface TimingMetric {
    count: number;
    sum: number;
    min: number;
    max: number;
    last: number;
}

export interface WorkerMetricsSnapshot {
    uptimeMs: number;
    counters: Record<string, number>;
    gauges: Record<string, number>;
    timings: Record<
        string,
        {
            count: number;
            sum: number;
            min: number;
            max: number;
            avg: number;
            last: number;
        }
    >;
}

class WorkerMetricsCollector {
    private startedAt = Date.now();
    private counters = new Map<string, number>();
    private gauges = new Map<string, number>();
    private timings = new Map<string, TimingMetric>();

    increment(name: string, value = 1): void {
        const current = this.counters.get(name) ?? 0;
        this.counters.set(name, current + value);
    }

    setGauge(name: string, value: number): void {
        this.gauges.set(name, value);
    }

    observe(name: string, value: number): void {
        const current = this.timings.get(name);
        if (!current) {
            this.timings.set(name, {
                count: 1,
                sum: value,
                min: value,
                max: value,
                last: value,
            });
            return;
        }

        current.count += 1;
        current.sum += value;
        current.min = Math.min(current.min, value);
        current.max = Math.max(current.max, value);
        current.last = value;
    }

    snapshot(): WorkerMetricsSnapshot {
        const timings: WorkerMetricsSnapshot["timings"] = {};

        for (const [name, metric] of this.timings.entries()) {
            timings[name] = {
                count: metric.count,
                sum: metric.sum,
                min: metric.min,
                max: metric.max,
                avg: metric.count > 0 ? metric.sum / metric.count : 0,
                last: metric.last,
            };
        }

        return {
            uptimeMs: Date.now() - this.startedAt,
            counters: Object.fromEntries(this.counters.entries()),
            gauges: Object.fromEntries(this.gauges.entries()),
            timings,
        };
    }
}

export const workerMetrics = new WorkerMetricsCollector();

export function logWorkerEvent(
    level: LogLevel,
    event: string,
    context: Record<string, unknown> = {},
): void {
    const entry = {
        timestamp: new Date().toISOString(),
        scope: "worker",
        level,
        event,
        ...context,
    };

    const payload = JSON.stringify(entry);
    if (level === "error") {
        console.error(payload);
        return;
    }

    if (level === "warn") {
        console.warn(payload);
        return;
    }

    if (level === "debug") {
        console.debug(payload);
        return;
    }

    console.log(payload);
}

export async function timeAsync<T>(
    metricName: string,
    task: () => Promise<T>,
): Promise<T> {
    const startedAt = Date.now();
    try {
        return await task();
    } finally {
        const durationMs = Date.now() - startedAt;
        workerMetrics.observe(metricName, durationMs);
    }
}

function normalizeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return { value: error };
}

/**
 * Debounced Queue for Embedding Jobs
 * 
 * This queue batches jobs that come in close succession (within DEBOUNCE_MS)
 * and deduplicates them by (table, pk) to avoid redundant work.
 */
interface QueuedJob extends EmbeddingJob {
    enqueuedAt: number;
    lastUpdatedAt: number;
}

export class DebouncedQueue {
    private jobs: Map<string, QueuedJob> = new Map();
    private timeout: NodeJS.Timeout | null = null;
    private processing: boolean = false;
    private onProcess: (jobs: EmbeddingJob[]) => Promise<void>;
    private debounceMs: number;

    constructor(onProcess: (jobs: EmbeddingJob[]) => Promise<void>, debounceMs: number = env.DEBOUNCE_MS) {
        this.onProcess = onProcess;
        this.debounceMs = debounceMs;
    }

    /**
     * Add a job to the queue
     */
    add(event: RagUpdateEvent): void {
        const jobId = `${event.table}:${event.pk}`;
        const now = Date.now();

        // Create or update job
        const existingJob = this.jobs.get(jobId);

        this.jobs.set(jobId, {
            id: jobId,
            table: event.table,
            pk: event.pk,
            action: event.action,
            timestamp: event.timestamp,
            retryCount: existingJob?.retryCount ?? 0,
            enqueuedAt: existingJob?.enqueuedAt ?? now,
            lastUpdatedAt: now,
        });

        workerMetrics.increment("queue.jobs_received");
        if (existingJob) {
            workerMetrics.increment("queue.jobs_deduplicated");
        }
        workerMetrics.setGauge("queue.pending", this.jobs.size);
        workerMetrics.setGauge("queue.processing", this.processing ? 1 : 0);

        logWorkerEvent("debug", "queue.job_added", {
            jobId,
            action: event.action,
            retryCount: existingJob?.retryCount ?? 0,
            pending: this.jobs.size,
            deduplicated: Boolean(existingJob),
        });

        // Reset debounce timer
        this.resetDebounce();
    }

    /**
     * Reset the debounce timer
     */
    private resetDebounce(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = setTimeout(() => {
            this.flush();
        }, this.debounceMs);
    }

    /**
     * Flush all jobs in the queue
     */
    async flush(): Promise<void> {
        if (this.processing || this.jobs.size === 0) {
            return;
        }

        this.processing = true;
        workerMetrics.setGauge("queue.processing", 1);

        // Get all jobs and clear the queue
        const jobsToProcess = Array.from(this.jobs.values());
        this.jobs.clear();
        workerMetrics.setGauge("queue.pending", this.jobs.size);

        const startedAt = Date.now();
        const jobWaitTimes = jobsToProcess.map((job) => startedAt - job.enqueuedAt);
        for (const waitMs of jobWaitTimes) {
            workerMetrics.observe("queue.job_wait_ms", waitMs);
        }
        workerMetrics.observe("queue.batch_size", jobsToProcess.length);
        workerMetrics.increment("queue.flushes");

        logWorkerEvent("info", "queue.flush_started", {
            batchSize: jobsToProcess.length,
            avgWaitMs:
                jobWaitTimes.length > 0
                    ? jobWaitTimes.reduce((sum, value) => sum + value, 0) / jobWaitTimes.length
                    : 0,
        });

        try {
            await this.onProcess(
                jobsToProcess.map((job) => ({
                    id: job.id,
                    table: job.table,
                    pk: job.pk,
                    action: job.action,
                    timestamp: job.timestamp,
                    retryCount: job.retryCount,
                })),
            );
            workerMetrics.increment("queue.batches_succeeded");
        } catch (error) {
            workerMetrics.increment("queue.batches_failed");
            logWorkerEvent("error", "queue.flush_failed", {
                batchSize: jobsToProcess.length,
                error: normalizeError(error),
            });
            // Re-queue failed jobs with incremented retry count
            let requeued = 0;
            let dropped = 0;
            for (const job of jobsToProcess) {
                if (job.retryCount < env.WORKER_RETRY_MAX) {
                    this.jobs.set(job.id, {
                        ...job,
                        retryCount: job.retryCount + 1,
                        lastUpdatedAt: Date.now(),
                    });
                    requeued += 1;
                } else {
                    dropped += 1;
                    logWorkerEvent("error", "queue.job_dropped", {
                        jobId: job.id,
                        table: job.table,
                        pk: job.pk,
                        retryCount: job.retryCount,
                        reason: "max_retries_exceeded",
                    });
                    // Here you could send to a dead-letter queue
                }
            }
            if (requeued > 0) {
                workerMetrics.increment("queue.jobs_retried", requeued);
            }
            if (dropped > 0) {
                workerMetrics.increment("queue.jobs_dropped", dropped);
            }
            workerMetrics.setGauge("queue.pending", this.jobs.size);
        } finally {
            this.processing = false;
            workerMetrics.setGauge("queue.processing", 0);
            workerMetrics.observe("queue.flush_ms", Date.now() - startedAt);

            // If there are jobs in the queue, schedule another flush
            if (this.jobs.size > 0) {
                this.resetDebounce();
            }

            logWorkerEvent("debug", "queue.flush_finished", {
                pending: this.jobs.size,
                processing: this.processing,
            });
        }
    }

    /**
     * Get queue statistics
     */
    getStats(): { pending: number; isProcessing: boolean; metrics: WorkerMetricsSnapshot } {
        return {
            pending: this.jobs.size,
            isProcessing: this.processing,
            metrics: workerMetrics.snapshot(),
        };
    }

    /**
     * Stop the queue
     */
    async stop(): Promise<void> {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        logWorkerEvent("info", "queue.stop_requested", {
            pending: this.jobs.size,
            processing: this.processing,
        });
        // Wait for current processing to complete
        while (this.processing) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        logWorkerEvent("info", "queue.stopped", {
            pending: this.jobs.size,
        });
    }
}

/**
 * Simple in-memory queue for testing
 * In production, consider using Redis or a proper message queue
 */
export class SimpleQueue {
    private jobs: EmbeddingJob[] = [];
    private processing: boolean = false;
    private onProcess: (job: EmbeddingJob) => Promise<void>;

    constructor(onProcess: (job: EmbeddingJob) => Promise<void>) {
        this.onProcess = onProcess;
    }

    async add(job: EmbeddingJob): Promise<void> {
        this.jobs.push(job);
        workerMetrics.increment("simple_queue.jobs_received");
        workerMetrics.setGauge("simple_queue.pending", this.jobs.length);
        logWorkerEvent("debug", "simple_queue.job_added", {
            jobId: job.id,
            pending: this.jobs.length,
        });

        if (!this.processing) {
            await this.processNext();
        }
    }

    private async processNext(): Promise<void> {
        if (this.jobs.length === 0) {
            this.processing = false;
            workerMetrics.setGauge("simple_queue.processing", 0);
            return;
        }

        this.processing = true;
        workerMetrics.setGauge("simple_queue.processing", 1);
        const job = this.jobs.shift();
        workerMetrics.setGauge("simple_queue.pending", this.jobs.length);

        if (job) {
            try {
                const startedAt = Date.now();
                await this.onProcess(job);
                workerMetrics.increment("simple_queue.jobs_succeeded");
                workerMetrics.observe("simple_queue.job_ms", Date.now() - startedAt);
            } catch (error) {
                workerMetrics.increment("simple_queue.jobs_failed");
                logWorkerEvent("error", "simple_queue.job_failed", {
                    jobId: job.id,
                    error: normalizeError(error),
                });

                if (job.retryCount < env.WORKER_RETRY_MAX) {
                    // Re-queue with delay
                    setTimeout(() => {
                        this.jobs.push({
                            ...job,
                            retryCount: job.retryCount + 1,
                        });
                        workerMetrics.increment("simple_queue.jobs_retried");
                        workerMetrics.setGauge("simple_queue.pending", this.jobs.length);
                    }, env.WORKER_RETRY_DELAY_MS * Math.pow(2, job.retryCount));
                } else {
                    logWorkerEvent("error", "simple_queue.job_dropped", {
                        jobId: job.id,
                        retryCount: job.retryCount,
                    });
                }
            }
        }

        // Process next
        await this.processNext();
    }

    getStats(): { pending: number; isProcessing: boolean } {
        return {
            pending: this.jobs.length,
            isProcessing: this.processing,
        };
    }
}
