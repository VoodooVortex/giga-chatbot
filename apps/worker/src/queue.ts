import type { EmbeddingJob, RagUpdateEvent } from "./types";
import { env } from "./config";

/**
 * Debounced Queue for Embedding Jobs
 * 
 * This queue batches jobs that come in close succession (within DEBOUNCE_MS)
 * and deduplicates them by (table, pk) to avoid redundant work.
 */
export class DebouncedQueue {
    private jobs: Map<string, EmbeddingJob> = new Map();
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

        // Create or update job
        const existingJob = this.jobs.get(jobId);

        this.jobs.set(jobId, {
            id: jobId,
            table: event.table,
            pk: event.pk,
            action: event.action,
            timestamp: event.timestamp,
            retryCount: existingJob?.retryCount ?? 0,
        });

        console.log(`[Queue] Added job: ${jobId} (${event.action})`);

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

        // Get all jobs and clear the queue
        const jobsToProcess = Array.from(this.jobs.values());
        this.jobs.clear();

        console.log(`[Queue] Flushing ${jobsToProcess.length} jobs`);

        try {
            await this.onProcess(jobsToProcess);
        } catch (error) {
            console.error("[Queue] Error processing jobs:", error);
            // Re-queue failed jobs with incremented retry count
            for (const job of jobsToProcess) {
                if (job.retryCount < env.WORKER_RETRY_MAX) {
                    this.jobs.set(job.id, {
                        ...job,
                        retryCount: job.retryCount + 1,
                    });
                } else {
                    console.error(`[Queue] Job ${job.id} exceeded max retries`);
                    // Here you could send to a dead-letter queue
                }
            }
        } finally {
            this.processing = false;

            // If there are jobs in the queue, schedule another flush
            if (this.jobs.size > 0) {
                this.resetDebounce();
            }
        }
    }

    /**
     * Get queue statistics
     */
    getStats(): { pending: number; isProcessing: boolean } {
        return {
            pending: this.jobs.size,
            isProcessing: this.processing,
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
        // Wait for current processing to complete
        while (this.processing) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
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
        console.log(`[SimpleQueue] Added job: ${job.id}`);

        if (!this.processing) {
            await this.processNext();
        }
    }

    private async processNext(): Promise<void> {
        if (this.jobs.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const job = this.jobs.shift();

        if (job) {
            try {
                await this.onProcess(job);
            } catch (error) {
                console.error(`[SimpleQueue] Error processing job ${job.id}:`, error);

                if (job.retryCount < env.WORKER_RETRY_MAX) {
                    // Re-queue with delay
                    setTimeout(() => {
                        this.jobs.push({
                            ...job,
                            retryCount: job.retryCount + 1,
                        });
                    }, env.WORKER_RETRY_DELAY_MS * Math.pow(2, job.retryCount));
                } else {
                    console.error(`[SimpleQueue] Job ${job.id} exceeded max retries`);
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