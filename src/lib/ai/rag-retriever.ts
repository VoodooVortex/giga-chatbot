/**
 * RAG Retriever using pgvector
 * Retrieves relevant context from vector database
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import { logger } from "@/lib/observability/logger";
import { logRAGRetrieval } from "@/lib/observability/audit";
import { metrics } from "@/lib/observability/metrics";
import type { RAGContext } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY_EMBEDDING);
const queryEmbeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const RAG_REQUEST_METRIC = "rag_requests_total";
const RAG_DURATION_METRIC = "rag_request_duration_ms";
const RAG_EMBEDDING_DURATION_METRIC = "rag_embedding_duration_ms";
const RAG_DB_DURATION_METRIC = "rag_db_duration_ms";
const RAG_SIMILARITY_METRIC = "rag_similarity_score";
const RAG_CONTEXTS_METRIC = "rag_contexts_returned_total";

interface EmbeddingResult {
    re_id: number;
    re_source_table: string;
    re_source_pk: string;
    re_content: string;
    similarity: number;
}

export interface RAGRetrievalTelemetry {
    strategy: "vector" | "hybrid";
    durationMs: number;
    embeddingMs: number;
    dbMs: number;
    contextCount: number;
    vectorCount: number;
    keywordCount: number;
    zeroHit: boolean;
    topSimilarity: number | null;
    averageSimilarity: number | null;
    minSimilarity: number;
}

export interface RAGRetrievalResult {
    contexts: RAGContext[];
    telemetry: RAGRetrievalTelemetry;
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
        requestId?: string;
    } = {}
): Promise<RAGContext[]> {
    return (await retrieveRAGContextWithTelemetry(query, options)).contexts;
}

export async function retrieveRAGContextWithTelemetry(
    query: string,
    options: {
        topK?: number;
        minSimilarity?: number;
        sourceFilter?: string[];
        requestId?: string;
    } = {}
): Promise<RAGRetrievalResult> {
    const { topK = 5, minSimilarity = 0.7, sourceFilter, requestId } = options;
    const requestStartedAt = Date.now();
    const vectorResult = await runVectorSearch(query, {
        topK,
        minSimilarity,
        sourceFilter,
    });

    const telemetry = buildTelemetry("vector", vectorResult.contexts, {
        durationMs: Date.now() - requestStartedAt,
        embeddingMs: vectorResult.embeddingMs,
        dbMs: vectorResult.dbMs,
        minSimilarity,
        vectorCount: vectorResult.contexts.length,
        keywordCount: 0,
    });

    recordRAGTelemetry(query, vectorResult.contexts, telemetry, requestId);

    return {
        contexts: vectorResult.contexts,
        telemetry,
    };
}

async function runVectorSearch(
    query: string,
    options: {
        topK?: number;
        minSimilarity?: number;
        sourceFilter?: string[];
    } = {}
): Promise<{
    contexts: RAGContext[];
    embeddingMs: number;
    dbMs: number;
}> {
    const { topK = 5, minSimilarity = 0.7, sourceFilter } = options;

    const embeddingStartedAt = Date.now();
    const queryEmbedding = await generateQueryEmbedding(query);
    const embeddingMs = Date.now() - embeddingStartedAt;
    const embeddingString = `[${queryEmbedding.join(",")}]`;

    const dbStartedAt = Date.now();
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

    const result = await db.execute(query_sql) as unknown as { rows: EmbeddingResult[] };
    const dbMs = Date.now() - dbStartedAt;

    return {
        contexts: result.rows.map((r) => ({
        content: r.re_content,
        source: `${r.re_source_table}:${r.re_source_pk}`,
        similarity: r.similarity,
        })),
        embeddingMs,
        dbMs,
    };
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
        requestId?: string;
    } = {}
): Promise<RAGContext[]> {
    return (await retrieveHybridContextWithTelemetry(query, options)).contexts;
}

export async function retrieveHybridContextWithTelemetry(
    query: string,
    options: {
        topK?: number;
        minSimilarity?: number;
        requestId?: string;
    } = {}
): Promise<RAGRetrievalResult> {
    const { topK = 5, minSimilarity = 0.6, requestId } = options;
    const requestStartedAt = Date.now();

    const vectorResult = await runVectorSearch(query, { topK: topK * 2, minSimilarity });
    const keywords = extractKeywords(query);
    const keywordSearchStartedAt = Date.now();

    let keywordResults: Array<{
        re_id: number;
        re_source_table: string;
        re_source_pk: string;
        re_content: string;
        rank: number;
    }> = [];

    if (keywords.length > 0) {
        const keywordPattern = keywords.join(" | ");
        const keywordResult = await db.execute(sql`
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
      `) as unknown as {
            rows: Array<{
                re_id: number;
                re_source_table: string;
                re_source_pk: string;
                re_content: string;
                rank: number;
            }>
        };
        keywordResults = keywordResult.rows;
    }
    const keywordDbMs = Date.now() - keywordSearchStartedAt;

    const combined = combineRetrievalResults(vectorResult.contexts, keywordResults, topK);
    const telemetry = buildTelemetry("hybrid", combined, {
        durationMs: Date.now() - requestStartedAt,
        embeddingMs: vectorResult.embeddingMs,
        dbMs: vectorResult.dbMs + keywordDbMs,
        minSimilarity,
        vectorCount: vectorResult.contexts.length,
        keywordCount: keywordResults.length,
    });

    recordRAGTelemetry(query, combined, telemetry, requestId, {
        vectorCount: vectorResult.contexts.length,
        keywordCount: keywordResults.length,
    });

    return {
        contexts: combined,
        telemetry,
    };
}

function combineRetrievalResults(
    vectorResults: RAGContext[],
    keywordResults: Array<{
        re_id: number;
        re_source_table: string;
        re_source_pk: string;
        re_content: string;
        rank: number;
    }>,
    topK: number
): RAGContext[] {
    const seen = new Set<string>();
    const combined: RAGContext[] = [];

    for (const result of vectorResults) {
        const sourceKey = normalizeSourceKey(result.source);
        if (!seen.has(sourceKey)) {
            seen.add(sourceKey);
            combined.push(result);
        }
    }

    for (const result of keywordResults) {
        const sourceKey = `${result.re_source_table}:${result.re_source_pk}`;
        if (!seen.has(sourceKey)) {
            seen.add(sourceKey);
            combined.push({
                content: result.re_content,
                source: sourceKey,
                similarity: result.rank,
            });
        }
    }

    return combined.slice(0, topK);
}

function buildTelemetry(
    strategy: "vector" | "hybrid",
    contexts: RAGContext[],
    timing: {
        durationMs: number;
        embeddingMs: number;
        dbMs: number;
        minSimilarity: number;
        vectorCount: number;
        keywordCount: number;
    }
): RAGRetrievalTelemetry {
    const similarities = contexts.map((context) => context.similarity).filter((value) =>
        Number.isFinite(value)
    );
    const topSimilarity = similarities.length > 0 ? similarities[0] ?? null : null;
    const averageSimilarity =
        similarities.length > 0
            ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length
            : null;

    return {
        strategy,
        durationMs: timing.durationMs,
        embeddingMs: timing.embeddingMs,
        dbMs: timing.dbMs,
        contextCount: contexts.length,
        vectorCount: timing.vectorCount,
        keywordCount: timing.keywordCount,
        zeroHit: contexts.length === 0,
        topSimilarity,
        averageSimilarity,
        minSimilarity: timing.minSimilarity,
    };
}

function recordRAGTelemetry(
    query: string,
    contexts: RAGContext[],
    telemetry: RAGRetrievalTelemetry,
    requestId?: string,
    counts?: { vectorCount?: number; keywordCount?: number }
): void {
    const labels = {
        strategy: telemetry.strategy,
        hit: telemetry.zeroHit ? "miss" : "hit",
    };

    metrics.counter(RAG_REQUEST_METRIC, labels);
    metrics.histogram(RAG_DURATION_METRIC, telemetry.durationMs, labels);
    metrics.histogram(RAG_EMBEDDING_DURATION_METRIC, telemetry.embeddingMs, labels);
    metrics.histogram(RAG_DB_DURATION_METRIC, telemetry.dbMs, labels);
    metrics.histogram(RAG_SIMILARITY_METRIC, telemetry.topSimilarity ?? 0, {
        ...labels,
        kind: "top1",
    });
    metrics.histogram(RAG_SIMILARITY_METRIC, telemetry.averageSimilarity ?? 0, {
        ...labels,
        kind: "avg",
    });
    metrics.counter(RAG_CONTEXTS_METRIC, labels, contexts.length);

    const contextSources = contexts.map((context) => context.source);
    const traceId = requestId || crypto.randomUUID();
    logRAGRetrieval(query, contexts.length, contextSources, traceId);

    logger.info("[RAG] retrieval complete", {
        requestId: traceId,
        strategy: telemetry.strategy,
        zeroHit: telemetry.zeroHit,
        contextCount: telemetry.contextCount,
        topSimilarity: telemetry.topSimilarity,
        averageSimilarity: telemetry.averageSimilarity,
        vectorCount: counts?.vectorCount ?? telemetry.vectorCount,
        keywordCount: counts?.keywordCount ?? telemetry.keywordCount,
        durationMs: telemetry.durationMs,
    });
}

function normalizeSourceKey(source: string): string {
    const trimmed = source.trim();
    if (!trimmed) return "unknown:unknown";
    const parts = trimmed.split(":");
    if (parts.length < 2) return trimmed;
    return `${parts[0]}:${parts.slice(1).join(":")}`;
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
