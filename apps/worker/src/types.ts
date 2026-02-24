/**
 * RAG Update Event from PostgreSQL NOTIFY
 */
export interface RagUpdateEvent {
    table: string;
    pk: string;
    action: "INSERT" | "UPDATE" | "DELETE";
    timestamp: number;
}

/**
 * Embedding Job for the queue
 */
export interface EmbeddingJob {
    id: string;
    table: string;
    pk: string;
    action: "INSERT" | "UPDATE" | "DELETE";
    timestamp: number;
    retryCount: number;
}

/**
 * Processed Record Data
 */
export interface RecordData {
    table: string;
    pk: string;
    content: string;
    updatedAt: Date;
}

/**
 * Chunk of text for embedding
 */
export interface TextChunk {
    content: string;
    index: number;
    total: number;
}

/**
 * Embedding Result
 */
export interface EmbeddingResult {
    embedding: number[];
    content: string;
    sourceTable: string;
    sourcePk: string;
    sourceUpdatedAt: Date;
}

/**
 * Worker Metrics
 */
export interface WorkerMetrics {
    jobsProcessed: number;
    jobsFailed: number;
    jobsInQueue: number;
    averageProcessingTime: number;
    lastProcessedAt: Date | null;
}