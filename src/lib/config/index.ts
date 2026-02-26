/**
 * Environment Configuration
 * Loads and validates environment variables
 * Note: In Docker, env vars are passed via docker-compose, no need for dotenv
 */

import { z } from "zod";

// Only load dotenv in development (not in Docker/Production)
if (process.env.NODE_ENV !== "production") {
    try {
        // Dynamic import to avoid Edge Runtime issues
        const dotenv = require("dotenv");
        dotenv.config({ path: ".env.local" });
        dotenv.config({ path: ".env" });
    } catch {
        // Silent fail in Edge Runtime
    }
}

const envSchema = z.object({
    // App
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3000"),
    BASE_PATH: z.string().default("/chat"),

    // Auth
    JWT_SECRET: z.string().default(""),
    COOKIE_NAME: z.string().default("orbistrack_jwt"),

    // Database
    DATABASE_URL: z.string().default(""),

    // Main App API
    MAIN_APP_URL: z.string().default("http://localhost:3001"),

    // AI Providers
    LLM_PROVIDER: z.enum(["google", "openrouter"]).default("google"),
    EMBEDDING_PROVIDER: z.enum(["google", "openrouter"]).default("google"),

    // Google AI (required)
    GOOGLE_API_KEY: z.string().default(""),
    GOOGLE_API_KEY_CHAT: z.string().default(""),
    GOOGLE_API_KEY_EMBEDDING: z.string().default(""),
    GOOGLE_MODEL_NAME: z.string().default("gemini-2.0-flash"),
    EMBEDDING_MODEL: z.string().default("embedding-001"),
    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_API_KEY_CHAT: z.string().default(""),
    OPENROUTER_API_KEY_EMBEDDING: z.string().default(""),
    OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
    OPENROUTER_MODEL_NAME: z.string().default("openai/gpt-4o-mini"),
    OPENROUTER_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    AI_TIMEOUT_MS: z.string().default("45000"),
    LOW_QUOTA_MODE: z.string().default("false"),
    ENABLE_LLM_INTENT_CLASSIFIER: z.string().default("true"),
    ENABLE_RAG_HYBRID_SEARCH: z.string().default("true"),
    ENABLE_RAG_GENERAL_QUESTION: z.string().default("true"),
    ENABLE_RAG_DEVICE_LOOKUP: z.string().default("false"),
    ENABLE_RAG_TICKET_LOOKUP: z.string().default("false"),
    QUERY_EMBEDDING_CACHE_TTL_MS: z.string().default("300000"),
    QUERY_EMBEDDING_CACHE_MAX_SIZE: z.string().default("256"),

    // RAG
    EMBEDDING_DIMENSION: z.string().default("768"),
    CHUNK_SIZE: z.string().default("512"),
    CHUNK_OVERLAP: z.string().default("50"),
    DEBOUNCE_MS: z.string().default("500"),

    // Worker
    WORKER_CONCURRENCY: z.string().default("5"),
    WORKER_RETRY_MAX: z.string().default("3"),
    WORKER_RETRY_DELAY_MS: z.string().default("1000"),

    // Logging
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    ENABLE_REQUEST_LOGGING: z.string().default("true"),
});

const parsed = envSchema.safeParse(process.env);

let envData: z.infer<typeof envSchema>;

if (!parsed.success) {
    console.warn("⚠️  Invalid environment variables, using defaults:");
    parsed.error.issues.forEach((issue) => {
        console.warn(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    // Use defaults during build time
    envData = envSchema.parse({});
} else {
    envData = parsed.data;
}

const hasGoogleChatKey = Boolean(envData.GOOGLE_API_KEY_CHAT || envData.GOOGLE_API_KEY);
const hasGoogleEmbeddingKey = Boolean(envData.GOOGLE_API_KEY_EMBEDDING || envData.GOOGLE_API_KEY);
const hasOpenRouterChatKey = Boolean(envData.OPENROUTER_API_KEY_CHAT || envData.OPENROUTER_API_KEY);
const hasOpenRouterEmbeddingKey = Boolean(envData.OPENROUTER_API_KEY_EMBEDDING || envData.OPENROUTER_API_KEY);

let resolvedLlmProvider = envData.LLM_PROVIDER;
if (resolvedLlmProvider === "openrouter" && !hasOpenRouterChatKey) {
    console.warn("⚠️  LLM_PROVIDER=openrouter but OpenRouter key is missing, falling back to google");
    resolvedLlmProvider = "google";
}
if (resolvedLlmProvider === "google" && !hasGoogleChatKey && hasOpenRouterChatKey) {
    console.warn("⚠️  Google chat key is missing, falling back to OpenRouter");
    resolvedLlmProvider = "openrouter";
}

let resolvedEmbeddingProvider = envData.EMBEDDING_PROVIDER;
if (resolvedEmbeddingProvider === "openrouter" && !hasOpenRouterEmbeddingKey) {
    console.warn("⚠️  EMBEDDING_PROVIDER=openrouter but OpenRouter key is missing, falling back to google");
    resolvedEmbeddingProvider = "google";
}
if (resolvedEmbeddingProvider === "google" && !hasGoogleEmbeddingKey && hasOpenRouterEmbeddingKey) {
    console.warn("⚠️  Google embedding key is missing, falling back to OpenRouter");
    resolvedEmbeddingProvider = "openrouter";
}

// Validate required vars at runtime (not build time)
function validateRequiredEnv() {
    const errors: string[] = [];

    if (!envData.JWT_SECRET) {
        errors.push("JWT_SECRET is required");
    }
    if (!envData.DATABASE_URL) {
        errors.push("DATABASE_URL is required");
    }
    if (resolvedLlmProvider === "google" && !envData.GOOGLE_API_KEY && !envData.GOOGLE_API_KEY_CHAT) {
        errors.push("GOOGLE_API_KEY (or GOOGLE_API_KEY_CHAT) is required when LLM_PROVIDER=google");
    }
    if (resolvedLlmProvider === "openrouter" && !envData.OPENROUTER_API_KEY && !envData.OPENROUTER_API_KEY_CHAT) {
        errors.push("OPENROUTER_API_KEY (or OPENROUTER_API_KEY_CHAT) is required when LLM_PROVIDER=openrouter");
    }
    if (resolvedEmbeddingProvider === "google" && !envData.GOOGLE_API_KEY && !envData.GOOGLE_API_KEY_EMBEDDING) {
        errors.push("GOOGLE_API_KEY (or GOOGLE_API_KEY_EMBEDDING) is required when EMBEDDING_PROVIDER=google");
    }
    if (resolvedEmbeddingProvider === "openrouter" && !envData.OPENROUTER_API_KEY && !envData.OPENROUTER_API_KEY_EMBEDDING) {
        errors.push("OPENROUTER_API_KEY (or OPENROUTER_API_KEY_EMBEDDING) is required when EMBEDDING_PROVIDER=openrouter");
    }

    if (errors.length > 0) {
        throw new Error(`Missing required environment variables: ${errors.join(", ")}`);
    }
}

export const env = {
    ...envData,
    LLM_PROVIDER: resolvedLlmProvider,
    EMBEDDING_PROVIDER: resolvedEmbeddingProvider,
    GOOGLE_API_KEY_CHAT: envData.GOOGLE_API_KEY_CHAT || envData.GOOGLE_API_KEY,
    GOOGLE_API_KEY_EMBEDDING: envData.GOOGLE_API_KEY_EMBEDDING || envData.GOOGLE_API_KEY,
    OPENROUTER_API_KEY_CHAT: envData.OPENROUTER_API_KEY_CHAT || envData.OPENROUTER_API_KEY,
    OPENROUTER_API_KEY_EMBEDDING: envData.OPENROUTER_API_KEY_EMBEDDING || envData.OPENROUTER_API_KEY,
    PORT: parseInt(envData.PORT, 10),
    EMBEDDING_DIMENSION: parseInt(envData.EMBEDDING_DIMENSION, 10),
    CHUNK_SIZE: parseInt(envData.CHUNK_SIZE, 10),
    CHUNK_OVERLAP: parseInt(envData.CHUNK_OVERLAP, 10),
    DEBOUNCE_MS: parseInt(envData.DEBOUNCE_MS, 10),
    WORKER_CONCURRENCY: parseInt(envData.WORKER_CONCURRENCY, 10),
    WORKER_RETRY_MAX: parseInt(envData.WORKER_RETRY_MAX, 10),
    WORKER_RETRY_DELAY_MS: parseInt(envData.WORKER_RETRY_DELAY_MS, 10),
    AI_TIMEOUT_MS: parseInt(envData.AI_TIMEOUT_MS, 10),
    QUERY_EMBEDDING_CACHE_TTL_MS: parseInt(envData.QUERY_EMBEDDING_CACHE_TTL_MS, 10),
    QUERY_EMBEDDING_CACHE_MAX_SIZE: parseInt(envData.QUERY_EMBEDDING_CACHE_MAX_SIZE, 10),
    LOW_QUOTA_MODE: envData.LOW_QUOTA_MODE === "true",
    ENABLE_LLM_INTENT_CLASSIFIER: envData.ENABLE_LLM_INTENT_CLASSIFIER === "true",
    ENABLE_RAG_HYBRID_SEARCH: envData.ENABLE_RAG_HYBRID_SEARCH === "true",
    ENABLE_RAG_GENERAL_QUESTION: envData.ENABLE_RAG_GENERAL_QUESTION === "true",
    ENABLE_RAG_DEVICE_LOOKUP: envData.ENABLE_RAG_DEVICE_LOOKUP === "true",
    ENABLE_RAG_TICKET_LOOKUP: envData.ENABLE_RAG_TICKET_LOOKUP === "true",
    ENABLE_REQUEST_LOGGING: envData.ENABLE_REQUEST_LOGGING === "true",

    // Validation function to call at runtime
    validate: validateRequiredEnv,
};

export type Env = typeof env;
