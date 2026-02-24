/**
 * Structured Logger
 * JSON logging with request context
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
    requestId?: string;
    userId?: string;
    roomId?: string;
    [key: string]: unknown;
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    latency?: number;
}

class Logger {
    private logLevel: LogLevel;

    constructor() {
        this.logLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
    }

    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ["debug", "info", "warn", "error"];
        return levels.indexOf(level) >= levels.indexOf(this.logLevel);
    }

    private formatLog(entry: LogEntry): string {
        if (process.env.LOG_FORMAT === "json") {
            return JSON.stringify(entry);
        }

        // Human readable format
        const contextStr = entry.context
            ? Object.entries(entry.context)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")
            : "";

        const latencyStr = entry.latency ? ` (${entry.latency}ms)` : "";

        return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${contextStr ? " | " + contextStr : ""}${latencyStr}`;
    }

    private log(level: LogLevel, message: string, context?: LogContext, error?: Error, latency?: number): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            latency,
        };

        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
            };
        }

        const output = this.formatLog(entry);

        switch (level) {
            case "error":
                console.error(output);
                break;
            case "warn":
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }

    debug(message: string, context?: LogContext): void {
        this.log("debug", message, context);
    }

    info(message: string, context?: LogContext): void {
        this.log("info", message, context);
    }

    warn(message: string, context?: LogContext, error?: Error): void {
        this.log("warn", message, context, error);
    }

    error(message: string, context?: LogContext, error?: Error): void {
        this.log("error", message, context, error);
    }

    /**
     * Log API request with latency
     */
    logRequest(
        method: string,
        path: string,
        statusCode: number,
        latencyMs: number,
        context?: LogContext
    ): void {
        const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
        this.log(level, `${method} ${path} ${statusCode}`, context, undefined, latencyMs);
    }

    /**
     * Create a child logger with preset context
     */
    child(context: LogContext): Logger {
        const childLogger = new Logger();
        const parentLog = this.log.bind(this);

        childLogger.log = (level: LogLevel, message: string, ctx?: LogContext, error?: Error, latency?: number) => {
            parentLog(level, message, { ...context, ...ctx }, error, latency);
        };

        return childLogger;
    }
}

// Singleton instance
export const logger = new Logger();
