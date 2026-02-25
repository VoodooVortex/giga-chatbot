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

    // Google AI (required)
    GOOGLE_API_KEY: z.string().default(""),
    GOOGLE_MODEL_NAME: z.string().default("gemini-1.5-flash"),

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

// Validate required vars at runtime (not build time)
function validateRequiredEnv() {
    const errors: string[] = [];

    if (!envData.JWT_SECRET) {
        errors.push("JWT_SECRET is required");
    }
    if (!envData.DATABASE_URL) {
        errors.push("DATABASE_URL is required");
    }
    if (!envData.GOOGLE_API_KEY) {
        errors.push("GOOGLE_API_KEY is required");
    }

    if (errors.length > 0) {
        throw new Error(`Missing required environment variables: ${errors.join(", ")}`);
    }
}

export const env = {
    ...envData,
    PORT: parseInt(envData.PORT, 10),
    EMBEDDING_DIMENSION: parseInt(envData.EMBEDDING_DIMENSION, 10),
    CHUNK_SIZE: parseInt(envData.CHUNK_SIZE, 10),
    CHUNK_OVERLAP: parseInt(envData.CHUNK_OVERLAP, 10),
    DEBOUNCE_MS: parseInt(envData.DEBOUNCE_MS, 10),
    WORKER_CONCURRENCY: parseInt(envData.WORKER_CONCURRENCY, 10),
    WORKER_RETRY_MAX: parseInt(envData.WORKER_RETRY_MAX, 10),
    WORKER_RETRY_DELAY_MS: parseInt(envData.WORKER_RETRY_DELAY_MS, 10),
    ENABLE_REQUEST_LOGGING: envData.ENABLE_REQUEST_LOGGING === "true",

    // Validation function to call at runtime
    validate: validateRequiredEnv,
};

export type Env = typeof env;
