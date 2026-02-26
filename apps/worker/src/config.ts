import { config } from "dotenv";
import { z } from "zod";

// Load environment variables
config({ path: ".env" });
config({ path: ".env.local", override: true });

const envSchema = z.object({
    // Database
    DATABASE_URL: z.string().url(),

    // Google (for embeddings)
    GOOGLE_API_KEY: z.string().default(""),
    GOOGLE_API_KEY_EMBEDDING: z.string().optional(),
    EMBEDDING_PROVIDER: z.enum(["google", "openrouter"]).default("google"),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY_EMBEDDING: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
    OPENROUTER_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

    // RAG Config
    EMBEDDING_MODEL: z.string().default("embedding-001"),
    EMBEDDING_DIMENSION: z.string().default("768"), // Google embedding-001 = 768
    CHUNK_SIZE: z.string().default("256"), // Google limit is 2048 tokens
    CHUNK_OVERLAP: z.string().default("50"),
    DEBOUNCE_MS: z.string().default("500"),

    // Worker Config
    WORKER_CONCURRENCY: z.string().default("5"),
    // Support both names for compatibility with compose/env files
    WORKER_RETRY_MAX: z.string().optional(),
    WORKER_MAX_RETRIES: z.string().optional(),
    WORKER_RETRY_DELAY_MS: z.string().default("1000"),

    // Logging
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    parsed.error.issues.forEach((issue) => {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    process.exit(1);
}

const hasGoogleKey = Boolean(parsed.data.GOOGLE_API_KEY || parsed.data.GOOGLE_API_KEY_EMBEDDING);
const hasOpenRouterKey = Boolean(parsed.data.OPENROUTER_API_KEY || parsed.data.OPENROUTER_API_KEY_EMBEDDING);

let resolvedEmbeddingProvider = parsed.data.EMBEDDING_PROVIDER;
if (resolvedEmbeddingProvider === "openrouter" && !hasOpenRouterKey) {
    console.warn("⚠️  EMBEDDING_PROVIDER=openrouter but OpenRouter key is missing, falling back to google");
    resolvedEmbeddingProvider = "google";
}
if (resolvedEmbeddingProvider === "google" && !hasGoogleKey && hasOpenRouterKey) {
    console.warn("⚠️  Google key is missing, falling back to OpenRouter embeddings");
    resolvedEmbeddingProvider = "openrouter";
}

export const env = {
    ...parsed.data,
    EMBEDDING_PROVIDER: resolvedEmbeddingProvider,
    GOOGLE_API_KEY_EMBEDDING: parsed.data.GOOGLE_API_KEY_EMBEDDING ?? parsed.data.GOOGLE_API_KEY,
    OPENROUTER_API_KEY_EMBEDDING:
        parsed.data.OPENROUTER_API_KEY_EMBEDDING ?? parsed.data.OPENROUTER_API_KEY ?? "",
    WORKER_RETRY_MAX: parseInt(
        parsed.data.WORKER_RETRY_MAX ?? parsed.data.WORKER_MAX_RETRIES ?? "3",
        10
    ),
    EMBEDDING_DIMENSION: parseInt(parsed.data.EMBEDDING_DIMENSION, 10),
    CHUNK_SIZE: parseInt(parsed.data.CHUNK_SIZE, 10),
    CHUNK_OVERLAP: parseInt(parsed.data.CHUNK_OVERLAP, 10),
    DEBOUNCE_MS: parseInt(parsed.data.DEBOUNCE_MS, 10),
    WORKER_CONCURRENCY: parseInt(parsed.data.WORKER_CONCURRENCY, 10),
    WORKER_RETRY_DELAY_MS: parseInt(parsed.data.WORKER_RETRY_DELAY_MS, 10),
};

export type Env = typeof env;