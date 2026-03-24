/**
 * Structured Logger
 * JSON logging with request context
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_LOG_STRING_LENGTH = 1000;
const MAX_LOG_ARRAY_LENGTH = 20;
const MAX_LOG_OBJECT_KEYS = 20;

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

function truncate(value: string, maxLength: number = MAX_LOG_STRING_LENGTH): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…`;
}

function normalizeLogValue(
    value: unknown,
    depth = 0,
    seen = new WeakSet<object>(),
): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return truncate(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return "[Function]";
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
        return {
            name: value.name,
            message: truncate(value.message),
            stack: value.stack ? truncate(value.stack, 4000) : undefined,
        };
    }

    if (depth >= 4) {
        return "[DepthLimit]";
    }

    if (Array.isArray(value)) {
        return value.slice(0, MAX_LOG_ARRAY_LENGTH).map((item) =>
            normalizeLogValue(item, depth + 1, seen)
        );
    }

    if (typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        if (seen.has(objectValue)) {
            return "[Circular]";
        }

        seen.add(objectValue);
        const entries = Object.entries(objectValue)
            .filter(([, entryValue]) => entryValue !== undefined)
            .slice(0, MAX_LOG_OBJECT_KEYS)
            .map(([key, entryValue]) => [key, normalizeLogValue(entryValue, depth + 1, seen)]);
        seen.delete(objectValue);
        return Object.fromEntries(entries);
    }

    return truncate(String(value));
}

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(normalizeLogValue(value));
    } catch {
        return JSON.stringify({
            message: "Unable to serialize log entry",
        });
    }
}

function formatContextValue(value: unknown): string {
    const normalized = normalizeLogValue(value);
    if (normalized === null || normalized === undefined) {
        return "";
    }

    if (typeof normalized === "string") {
        return normalized;
    }

    if (
        typeof normalized === "number" ||
        typeof normalized === "boolean" ||
        typeof normalized === "bigint"
    ) {
        return String(normalized);
    }

    return truncate(safeJsonStringify(normalized), 240);
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
            return safeJsonStringify(entry);
        }

        // Human readable format
        const contextStr = entry.context
            ? Object.entries(entry.context)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k}=${formatContextValue(v)}`)
                .join(" ")
            : "";

        const latencyStr = typeof entry.latency === "number" ? ` (${entry.latency}ms)` : "";

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
