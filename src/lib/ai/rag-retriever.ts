/**
 * RAG Retriever using pgvector
 * Retrieves relevant context from vector database
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { RAGContext } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY_EMBEDDING);
const queryEmbeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();

interface EmbeddingResult {
    re_id: number;
    re_source_table: string;
    re_source_pk: string;
    re_content: string;
    similarity: number;
}

/**
 * Generate embedding for query using configured Google embedding model
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    const cacheKey = normalizeQuery(query);
    const now = Date.now();
    const cached = queryEmbeddingCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
        return cached.embedding;
    }

    const embedding = env.EMBEDDING_PROVIDER === "openrouter"
        ? await embedWithOpenRouter(query)
        : await embedWithGoogle(query);

    queryEmbeddingCache.set(cacheKey, {
        embedding,
        expiresAt: now + env.QUERY_EMBEDDING_CACHE_TTL_MS,
    });

    // Keep cache bounded (simple FIFO eviction by insertion order)
    while (queryEmbeddingCache.size > env.QUERY_EMBEDDING_CACHE_MAX_SIZE) {
        const firstKey = queryEmbeddingCache.keys().next().value as string | undefined;
        if (!firstKey) break;
        queryEmbeddingCache.delete(firstKey);
    }

    return embedding;
}

async function embedWithGoogle(query: string): Promise<number[]> {
    const model = genAI.getGenerativeModel({ model: env.EMBEDDING_MODEL });
    const result = await model.embedContent(query);
    return result.embedding.values;
}

async function embedWithOpenRouter(query: string): Promise<number[]> {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENROUTER_API_KEY_EMBEDDING}`,
        },
        body: JSON.stringify({
            model: env.OPENROUTER_EMBEDDING_MODEL,
            input: query,
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
      re_source_pk,
      re_content,
      1 - (re_embedding <=> ${embeddingString}::vector) as similarity
    FROM rag.embeddings
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
        source: `${r.re_source_table}:${r.re_source_pk}`,
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
      re_source_pk,
      re_content,
      ts_rank(to_tsvector('english', re_content), to_tsquery(${keywordPattern})) as rank
    FROM rag.embeddings
    WHERE to_tsvector('english', re_content) @@ to_tsquery(${keywordPattern})
    ORDER BY rank DESC
    LIMIT ${topK}
  `) as unknown as Array<{
        re_id: number;
        re_source_table: string;
        re_source_pk: string;
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
                source: `${r.re_source_table}:${r.re_source_pk}`,
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

function normalizeQuery(query: string): string {
    return query.toLowerCase().replace(/\s+/g, " ").trim();
}
