import { RagUpdateListener } from "./listener";
import { pool } from "./db";

/**
 * RAG Worker Main Entry Point
 * 
 * This worker listens for PostgreSQL NOTIFY events on the 'rag_update' channel
 * and processes them to keep the vector embeddings up to date.
 */

const listener = new RagUpdateListener();

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
    console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);

    try {
        // Stop the listener
        await listener.stop();

        // Close database pool
        await pool.end();

        console.log("[Worker] Shutdown complete");
        process.exit(0);
    } catch (error) {
        console.error("[Worker] Error during shutdown:", error);
        process.exit(1);
    }
}

/**
 * Main function
 */
async function main(): Promise<void> {
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║           RAG Worker - Giga Chatbot                   ║");
    console.log("╚════════════════════════════════════════════════════════╝");
    console.log();

    try {
        // Register shutdown handlers
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("uncaughtException", (error) => {
            console.error("[Worker] Uncaught exception:", error);
            shutdown("uncaughtException");
        });
        process.on("unhandledRejection", (reason) => {
            console.error("[Worker] Unhandled rejection:", reason);
            shutdown("unhandledRejection");
        });

        // Start the listener
        await listener.start();

        console.log();
        console.log("[Worker] Running... Press Ctrl+C to stop");
        console.log();

        // Keep the process alive
        setInterval(() => {
            const stats = listener.getStats();
            console.log(
                `[Worker] Status: ${stats.isRunning ? "running" : "stopped"}, ` +
                `Queue: ${stats.queueStats.pending} pending, ` +
                `Processing: ${stats.queueStats.isProcessing ? "yes" : "no"}`
            );
        }, 30000); // Log stats every 30 seconds

    } catch (error) {
        console.error("[Worker] Fatal error:", error);
        await shutdown("fatal error");
    }
}

// Run the worker
main();