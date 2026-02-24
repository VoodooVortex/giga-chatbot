import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./config";
import type { TextChunk, EmbeddingResult, RecordData } from "./types";

// Initialize Google Generative AI client
const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);

/**
 * Chunk text into smaller pieces for embedding
 */
export function chunkText(text: string, chunkSize: number = env.CHUNK_SIZE, overlap: number = env.CHUNK_OVERLAP): TextChunk[] {
    // For Google, limit is 2048 tokens, so we use smaller chunks
    const effectiveChunkSize = Math.min(chunkSize, 256); // Google limit is lower

    if (text.length <= effectiveChunkSize) {
        return [{ content: text, index: 0, total: 1 }];
    }

    const chunks: TextChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < text.length) {
        let end = start + effectiveChunkSize;

        // Try to find a good break point (newline or space)
        if (end < text.length) {
            const nextNewline = text.indexOf("\n", end - 50);
            if (nextNewline !== -1 && nextNewline < end + 50) {
                end = nextNewline + 1;
            } else {
                const lastSpace = text.lastIndexOf(" ", end);
                if (lastSpace > start) {
                    end = lastSpace;
                }
            }
        }

        chunks.push({
            content: text.slice(start, end).trim(),
            index,
            total: 0, // Will be updated after
        });

        // Move start with overlap
        start = end - overlap;
        if (start <= 0 || start >= text.length) {
            start = end;
        }
        index++;
    }

    // Update total count
    chunks.forEach((chunk, i) => {
        chunk.index = i;
        chunk.total = chunks.length;
    });

    return chunks;
}

/**
 * Generate embeddings for text chunks using Google
 */
export async function generateEmbeddings(chunks: TextChunk[]): Promise<number[][]> {
    if (chunks.length === 0) {
        return [];
    }

    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

    try {
        const embeddings: number[][] = [];

        // Google doesn't support batching in the same way, so we process one by one
        for (const chunk of chunks) {
            const result = await model.embedContent(chunk.content);
            embeddings.push(result.embedding.values);
        }

        return embeddings;
    } catch (error) {
        console.error("Error generating embeddings with Google:", error);
        throw error;
    }
}

/**
 * Process a record and generate embeddings
 */
export async function processRecord(recordData: RecordData): Promise<EmbeddingResult[]> {
    // Chunk the content
    const chunks = chunkText(recordData.content);

    if (chunks.length === 0) {
        return [];
    }

    // Generate embeddings for all chunks
    const embeddings = await generateEmbeddings(chunks);

    // Return results
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