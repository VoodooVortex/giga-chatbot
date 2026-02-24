import type { PoolClient } from "pg";
import type { RagUpdateEvent, EmbeddingJob } from "./types";
import { getListenClient } from "./db";
import { DebouncedQueue } from "./queue";
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
            console.log("[Listener] Already running");
            return;
        }

        console.log("[Listener] Starting...");

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
            console.log("[Listener] Listening on 'rag_update' channel");
        } catch (error) {
            console.error("[Listener] Error starting:", error);
            throw error;
        }
    }

    /**
     * Handle incoming notification
     */
    private handleNotification(payload: string): void {
        try {
            const event: RagUpdateEvent = JSON.parse(payload);
            console.log(`[Listener] Received event: ${event.table}:${event.pk} (${event.action})`);

            // Add to queue for debounced processing
            this.queue.add(event);
        } catch (error) {
            console.error("[Listener] Error parsing notification:", error);
        }
    }

    /**
     * Process a batch of jobs
     */
    private async processJobs(jobs: EmbeddingJob[]): Promise<void> {
        console.log(`[Listener] Processing ${jobs.length} jobs`);

        // Process DELETE actions first
        const deleteJobs = jobs.filter((j) => j.action === "DELETE");
        const otherJobs = jobs.filter((j) => j.action !== "DELETE");

        // Handle deletions
        for (const job of deleteJobs) {
            try {
                await deleteEmbedding(job.table, job.pk);
                console.log(`[Listener] Deleted embedding for ${job.table}:${job.pk}`);
            } catch (error) {
                console.error(`[Listener] Error deleting embedding for ${job.table}:${job.pk}:`, error);
                throw error;
            }
        }

        // Handle INSERT/UPDATE
        for (const job of otherJobs) {
            try {
                await this.processJob(job);
            } catch (error) {
                console.error(`[Listener] Error processing job ${job.id}:`, error);
                throw error;
            }
        }

        console.log(`[Listener] Completed processing ${jobs.length} jobs`);
    }

    /**
     * Process a single job
     */
    private async processJob(job: EmbeddingJob): Promise<void> {
        console.log(`[Listener] Processing job: ${job.id}`);

        // Fetch record data from database
        const recordData = await fetchRecordData(job.table, job.pk);

        if (!recordData) {
            console.warn(`[Listener] Record not found: ${job.table}:${job.pk}`);
            // If record doesn't exist, delete any existing embedding
            await deleteEmbedding(job.table, job.pk);
            return;
        }

        // Generate embeddings
        const embeddingResults = await processRecord(recordData);

        if (embeddingResults.length === 0) {
            console.warn(`[Listener] No embeddings generated for ${job.table}:${job.pk}`);
            return;
        }

        // For simplicity, we use the first chunk's embedding
        // In production, you might want to store all chunks
        const result = embeddingResults[0];

        // Upsert to database
        await upsertEmbedding(
            result.sourceTable,
            result.sourcePk,
            result.content,
            result.embedding,
            result.sourceUpdatedAt
        );

        console.log(`[Listener] Processed job: ${job.id}`);
    }

    /**
     * Stop the listener
     */
    async stop(): Promise<void> {
        console.log("[Listener] Stopping...");

        this.isRunning = false;

        // Stop the queue
        await this.queue.stop();

        // Release client
        if (this.client) {
            await this.client.query("UNLISTEN rag_update");
            this.client.release();
            this.client = null;
        }

        console.log("[Listener] Stopped");
    }

    /**
     * Get current stats
     */
    getStats(): { isRunning: boolean; queueStats: { pending: number; isProcessing: boolean } } {
        return {
            isRunning: this.isRunning,
            queueStats: this.queue.getStats(),
        };
    }
}