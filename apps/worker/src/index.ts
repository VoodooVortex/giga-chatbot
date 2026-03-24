import { RagUpdateListener } from "./listener";
import { pool } from "./db";
import { logWorkerEvent, workerMetrics } from "./queue";

/**
 * RAG Worker Main Entry Point
 * 
 * This worker listens for PostgreSQL NOTIFY events on the 'rag_update' channel
 * and processes them to keep the vector embeddings up to date.
 */

const listener = new RagUpdateListener();
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
    logWorkerEvent("info", "worker.shutdown_requested", { signal });
    workerMetrics.increment("worker.shutdowns");

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    try {
        // Stop the listener
        await listener.stop();

        // Close database pool
        await pool.end();

        logWorkerEvent("info", "worker.shutdown_complete", { signal });
        process.exit(0);
    } catch (error) {
        logWorkerEvent("error", "worker.shutdown_failed", {
            signal,
            error: error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                }
                : { value: error },
        });
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
    logWorkerEvent("info", "worker.starting", {
        pid: process.pid,
    });
    workerMetrics.increment("worker.startups");

    try {
        // Register shutdown handlers
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("uncaughtException", (error) => {
            logWorkerEvent("error", "worker.uncaught_exception", {
                error: error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    }
                    : { value: error },
            });
            shutdown("uncaughtException");
        });
        process.on("unhandledRejection", (reason) => {
            logWorkerEvent("error", "worker.unhandled_rejection", {
                reason: reason instanceof Error
                    ? {
                        name: reason.name,
                        message: reason.message,
                        stack: reason.stack,
                    }
                    : { value: reason },
            });
            shutdown("unhandledRejection");
        });

        // Start the listener
        await listener.start();

        console.log();
        console.log("[Worker] Running... Press Ctrl+C to stop");
        console.log();

        heartbeatTimer = setInterval(() => {
            const stats = listener.getStats();
            workerMetrics.setGauge("worker.is_running", stats.isRunning ? 1 : 0);
            workerMetrics.setGauge("worker.last_heartbeat_epoch_ms", Date.now());
            logWorkerEvent("info", "worker.heartbeat", {
                running: stats.isRunning,
                queuePending: stats.queueStats.pending,
                queueProcessing: stats.queueStats.isProcessing,
                uptimeMs: stats.queueStats.metrics.uptimeMs,
                metrics: stats.queueStats.metrics,
            });
        }, 30000);

    } catch (error) {
        logWorkerEvent("error", "worker.fatal_error", {
            error: error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                }
                : { value: error },
        });
        await shutdown("fatal error");
    }
}

// Run the worker
main();
