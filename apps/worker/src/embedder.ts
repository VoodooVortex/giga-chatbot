import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./config";
import type { TextChunk, EmbeddingResult, RecordData } from "./types";
import { logWorkerEvent, timeAsync, workerMetrics } from "./queue";

// Initialize Google Generative AI client
const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY_EMBEDDING);

/**
 * Chunk text into smaller pieces for embedding
 */
export function chunkText(text: string, chunkSize: number = env.CHUNK_SIZE, overlap: number = env.CHUNK_OVERLAP): TextChunk[] {
    const normalizedText = String(text ?? "").trim();

    if (normalizedText.length === 0) {
        workerMetrics.increment("embedding.zero_content_inputs");
        logWorkerEvent("warn", "embedding.chunk_skipped_empty_content", {});
        return [];
    }

    // For Google, limit is 2048 tokens, so we use smaller chunks
    const effectiveChunkSize = Math.min(chunkSize, 256); // Google limit is lower

    if (normalizedText.length <= effectiveChunkSize) {
        workerMetrics.observe("embedding.chunk_count", 1);
        return [{ content: normalizedText, index: 0, total: 1 }];
    }

    const chunks: TextChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < normalizedText.length) {
        let end = start + effectiveChunkSize;

        // Try to find a good break point (newline or space)
        if (end < normalizedText.length) {
            const nextNewline = normalizedText.indexOf("\n", end - 50);
            if (nextNewline !== -1 && nextNewline < end + 50) {
                end = nextNewline + 1;
            } else {
                const lastSpace = normalizedText.lastIndexOf(" ", end);
                if (lastSpace > start) {
                    end = lastSpace;
                }
            }
        }

        chunks.push({
            content: normalizedText.slice(start, end).trim(),
            index,
            total: 0, // Will be updated after
        });

        // Move start with overlap
        start = end - overlap;
        if (start <= 0 || start >= normalizedText.length) {
            start = end;
        }
        index++;
    }

    // Update total count
    chunks.forEach((chunk, i) => {
        chunk.index = i;
        chunk.total = chunks.length;
    });

    workerMetrics.observe("embedding.chunk_count", chunks.length);
    return chunks;
}

/**
 * Generate embeddings for text chunks using Google
 */
export async function generateEmbeddings(chunks: TextChunk[]): Promise<number[][]> {
    if (chunks.length === 0) {
        workerMetrics.increment("embedding.zero_chunk_batches");
        logWorkerEvent("warn", "embedding.no_chunks_to_process", {});
        return [];
    }

    try {
        const embeddings: number[][] = [];
        const batchCache = new Map<string, number[]>();
        workerMetrics.observe("embedding.batch_size", chunks.length);

        // Process one-by-one to keep behavior consistent across providers.
        for (const chunk of chunks) {
            const cacheKey = chunk.content.trim();
            const cached = batchCache.get(cacheKey);
            if (cached) {
                embeddings.push(cached);
                workerMetrics.increment("embedding.cache_hits");
                continue;
            }

            const provider = env.EMBEDDING_PROVIDER;
            const vector = await timeAsync(`embedding.provider_ms.${provider}`, () =>
                provider === "openrouter"
                    ? embedWithOpenRouter(chunk.content)
                    : embedWithGoogle(chunk.content),
            );

            batchCache.set(cacheKey, vector);
            embeddings.push(vector);
            workerMetrics.increment("embedding.calls");
            workerMetrics.increment(`embedding.provider_calls.${provider}`);
            workerMetrics.observe("embedding.vector_dimensions", vector.length);
            if (vector.length === 0) {
                workerMetrics.increment("embedding.empty_vectors");
                logWorkerEvent("warn", "embedding.empty_vector", {
                    chunkIndex: chunk.index,
                    chunkTotal: chunk.total,
                });
            }
        }

        return embeddings;
    } catch (error) {
        workerMetrics.increment("embedding.batch_failures");
        logWorkerEvent("error", "embedding.batch_failed", {
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

async function embedWithGoogle(text: string): Promise<number[]> {
    const model = genAI.getGenerativeModel({ model: env.EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

async function embedWithOpenRouter(text: string): Promise<number[]> {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENROUTER_API_KEY_EMBEDDING}`,
        },
        body: JSON.stringify({
            model: env.OPENROUTER_EMBEDDING_MODEL,
            input: text,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter embedding failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
    };

    const embedding = payload.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
        throw new Error("OpenRouter embedding response did not include vector data");
    }

    return embedding;
}

/**
 * Process a record and generate embeddings
 */
export async function processRecord(recordData: RecordData): Promise<EmbeddingResult[]> {
    // Chunk the content
    const chunks = chunkText(recordData.content);

    if (chunks.length === 0) {
        workerMetrics.increment("embedding.zero_output_records");
        logWorkerEvent("warn", "embedding.record_skipped_no_chunks", {
            table: recordData.table,
            pk: recordData.pk,
        });
        return [];
    }

    // Generate embeddings for all chunks
    const embeddings = await timeAsync("embedding.record_ms", () => generateEmbeddings(chunks));

    // Return results
    workerMetrics.observe("embedding.record_chunk_count", chunks.length);
    return chunks.map((chunk, i) => ({
        embedding: embeddings[i],
        content: chunk.content,
        sourceTable: recordData.table,
        sourcePk: recordData.pk,
        sourceUpdatedAt: recordData.updatedAt,
    }));
}

/**
 * Test the embedder (for debugging)
 */
export async function testEmbedder(): Promise<void> {
    const testText = `
    Device: MacBook Pro 16-inch
    Serial: C02ABC123DEF
    Description: High-performance laptop for developers
    Location: IT Department, Floor 3
    Max Borrow Days: 14
  `;

    console.log("Testing Google embedder...");
    const chunks = chunkText(testText);
    console.log(`Created ${chunks.length} chunks`);

    const embeddings = await generateEmbeddings(chunks);
    console.log(`Generated ${embeddings.length} embeddings`);
    console.log(`Embedding dimension: ${embeddings[0]?.length}`);

    if (embeddings[0]) {
        console.log("✅ Google Embedder test passed");
    }
}
