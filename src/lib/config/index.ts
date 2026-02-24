import { config } from "dotenv";
import { z } from "zod";

// Load environment variables
config({ path: ".env.local" });

const envSchema = z.object({
    // App
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3000"),
    BASE_PATH: z.string().default("/chat"),

    // Auth
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    COOKIE_NAME: z.string().default("orbistrack_jwt"),

    // Database
    DATABASE_URL: z.string().url(),

    // Main App API
    MAIN_APP_URL: z.string().url().default("http://localhost:3001"),

    // OpenAI
    OPENAI_API_KEY: z.string().startsWith("sk-"),

    // Google
    GOOGLE_API_KEY: z.string(),
    GOOGLE_MODEL_NAME: z.string().default("gemini-2.5-flash"),

    // RAG
    EMBEDDING_DIMENSION: z.string().default("1536"),
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

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    parsed.error.issues.forEach((issue) => {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    // Throw error instead of process.exit for Edge Runtime compatibility
    throw new Error(
        `Invalid environment variables: ${parsed.error.issues.map(i => i.path.join(".")).join(", ")}`
    );
}

export const env = {
    ...parsed.data,
    PORT: parseInt(parsed.data.PORT, 10),
    EMBEDDING_DIMENSION: parseInt(parsed.data.EMBEDDING_DIMENSION, 10),
    CHUNK_SIZE: parseInt(parsed.data.CHUNK_SIZE, 10),
    CHUNK_OVERLAP: parseInt(parsed.data.CHUNK_OVERLAP, 10),
    DEBOUNCE_MS: parseInt(parsed.data.DEBOUNCE_MS, 10),
    WORKER_CONCURRENCY: parseInt(parsed.data.WORKER_CONCURRENCY, 10),
    WORKER_RETRY_MAX: parseInt(parsed.data.WORKER_RETRY_MAX, 10),
    WORKER_RETRY_DELAY_MS: parseInt(parsed.data.WORKER_RETRY_DELAY_MS, 10),
    ENABLE_REQUEST_LOGGING: parsed.data.ENABLE_REQUEST_LOGGING === "true",
};

export type Env = typeof env;