/**
 * RAG Retriever using pgvector
 * Retrieves relevant context from vector database
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { RAGContext } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);

interface EmbeddingResult {
    re_id: number;
    re_source_table: string;
    re_source_id: string;
    re_content: string;
    re_metadata: Record<string, unknown>;
    similarity: number;
}

/**
 * Generate embedding for query using configured Google embedding model
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    const model = genAI.getGenerativeModel({ model: env.EMBEDDING_MODEL });
    const result = await model.embedContent(query);
    return result.embedding.values;
}

/**
 * Retrieve relevant contexts from pgvector
 * Uses cosine similarity for vector search
 */
export async function retrieveRAGContext(
    query: string,
    options: {
        topK?: number;
        minSimilarity?: number;
        sourceFilter?: string[];
    } = {}
): Promise<RAGContext[]> {
    const { topK = 5, minSimilarity = 0.7, sourceFilter } = options;

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query);
    const embeddingString = `[${queryEmbedding.join(",")}]`;

    // Build the SQL query with vector similarity search
    let query_sql = sql`
    SELECT 
      re_id,
      re_source_table,
      re_source_id,
      re_content,
      re_metadata,
      1 - (re_embedding <=> ${embeddingString}::vector) as similarity
    FROM rag_embeddings
    WHERE 1 - (re_embedding <=> ${embeddingString}::vector) >= ${minSimilarity}
  `;

    // Add source filter if provided
    if (sourceFilter && sourceFilter.length > 0) {
        query_sql = sql`${query_sql} AND re_source_table IN (${sql.join(sourceFilter.map(s => sql`${s}`), sql`, `)})`;
    }

    // Order by similarity and limit results
    query_sql = sql`${query_sql} ORDER BY similarity DESC LIMIT ${topK}`;

    const results = await db.execute(query_sql) as unknown as EmbeddingResult[];

    return results.map(r => ({
        content: r.re_content,
        source: `${r.re_source_table}:${r.re_source_id}`,
        similarity: r.similarity,
    }));
}

/**
 * Hybrid search: Combine vector similarity with keyword matching
 * for better retrieval performance
 */
export async function retrieveHybridContext(
    query: string,
    options: {
        topK?: number;
        minSimilarity?: number;
    } = {}
): Promise<RAGContext[]> {
    const { topK = 5, minSimilarity = 0.6 } = options;

    // Get vector search results
    const vectorResults = await retrieveRAGContext(query, { topK: topK * 2, minSimilarity });

    // Extract keywords for text search
    const keywords = extractKeywords(query);

    if (keywords.length === 0) {
        return vectorResults.slice(0, topK);
    }

    // Build keyword search query
    const keywordPattern = keywords.join(" | ");
    const keywordResults = await db.execute(sql`
    SELECT 
      re_id,
      re_source_table,
      re_source_id,
      re_content,
      re_metadata,
      ts_rank(to_tsvector('english', re_content), to_tsquery(${keywordPattern})) as rank
    FROM rag_embeddings
    WHERE to_tsvector('english', re_content) @@ to_tsquery(${keywordPattern})
    ORDER BY rank DESC
    LIMIT ${topK}
  `) as unknown as Array<{
        re_id: number;
        re_source_table: string;
        re_source_id: string;
        re_content: string;
        rank: number;
    }>;

    // Combine and deduplicate results
    const seen = new Set<number>();
    const combined: RAGContext[] = [];

    // Add vector results first (higher priority)
    for (const r of vectorResults) {
        const id = parseInt(r.source.split(":")[1] || "0");
        if (!seen.has(id)) {
            seen.add(id);
            combined.push(r);
        }
    }

    // Add keyword results
    for (const r of keywordResults) {
        if (!seen.has(r.re_id)) {
            seen.add(r.re_id);
            combined.push({
                content: r.re_content,
                source: `${r.re_source_table}:${r.re_source_id}`,
                similarity: r.rank, // Use rank as similarity score
            });
        }
    }

    return combined.slice(0, topK);
}

function extractKeywords(query: string): string[] {
    // Remove stop words and extract meaningful keywords
    const stopWords = new Set([
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "how", "what", "when", "where", "why", "who", "which",
        "to", "of", "in", "for", "on", "with", "at", "by",
        "อยาก", "ต้องการ", "ช่วย", "บอก", "หน่อย", "ค่ะ", "ครับ"
    ]);

    return query
        .toLowerCase()
        .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));
}
