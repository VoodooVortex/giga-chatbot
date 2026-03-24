/**
 * Audit Logging
 * Track important actions for compliance and security.
 *
 * There is no dedicated audit table in this repository yet, so the durable
 * persistence path is the structured application log stream. The in-memory
 * buffer is kept only for batch summaries and future persistence hooks.
 */

import { logger } from "./logger";

export type AuditAction =
    | "chat.message.sent"
    | "chat.message.received"
    | "chat.room.created"
    | "chat.room.deleted"
    | "tool.device.search"
    | "tool.device.view"
    | "tool.issue.search"
    | "tool.issue.view"
    | "tool.notification.read"
    | "file.uploaded"
    | "file.downloaded"
    | "user.login"
    | "user.logout"
    | "rag.context.retrieved"
    | "ai.response.generated";

interface AuditLogEntry {
    action: AuditAction;
    userId?: string;
    roomId?: string;
    requestId: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    success: boolean;
    errorMessage?: string;
}

type SerializableAuditLogEntry = Omit<AuditLogEntry, "timestamp" | "details"> & {
    timestamp: string;
    details?: unknown;
};

const auditBuffer: AuditLogEntry[] = [];
const BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;
const MAX_AUDIT_STRING_LENGTH = 1200;
const MAX_AUDIT_ARRAY_LENGTH = 25;
const MAX_AUDIT_OBJECT_KEYS = 25;
const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|authorization|cookie|session|api[_-]?key|bearer)/i;
const globalForAudit = globalThis as typeof globalThis & {
    __auditFlushTimer?: ReturnType<typeof setInterval>;
};

function truncate(value: string, maxLength: number = MAX_AUDIT_STRING_LENGTH): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…`;
}

function sanitizeValue(
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
        return value.slice(0, MAX_AUDIT_ARRAY_LENGTH).map((item) =>
            sanitizeValue(item, depth + 1, seen)
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
            .slice(0, MAX_AUDIT_OBJECT_KEYS)
            .map(([key, entryValue]) => {
                if (SENSITIVE_KEY_PATTERN.test(key)) {
                    return [key, "[Redacted]"];
                }
                return [key, sanitizeValue(entryValue, depth + 1, seen)];
            });
        seen.delete(objectValue);
        return Object.fromEntries(entries);
    }

    return truncate(String(value));
}

function serializeAuditEntry(entry: AuditLogEntry): SerializableAuditLogEntry {
    return {
        action: entry.action,
        userId: entry.userId,
        roomId: entry.roomId,
        requestId: entry.requestId,
        details: entry.details ? sanitizeValue(entry.details) : undefined,
        ipAddress: entry.ipAddress ? truncate(entry.ipAddress, 128) : undefined,
        userAgent: entry.userAgent ? truncate(entry.userAgent, 512) : undefined,
        timestamp: entry.timestamp.toISOString(),
        success: entry.success,
        errorMessage: entry.errorMessage ? truncate(entry.errorMessage) : undefined,
    };
}

function safeAuditSummary(entry: AuditLogEntry): Record<string, unknown> {
    const serialized = serializeAuditEntry(entry);
    return {
        audit: true,
        ...serialized,
    };
}

function flushTimer(): void {
    if (globalForAudit.__auditFlushTimer) return;
    if (typeof setInterval !== "function") return;

    const timer = setInterval(() => {
        void flushAuditLogs();
    }, FLUSH_INTERVAL_MS);

    if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
    }

    globalForAudit.__auditFlushTimer = timer;
}

/**
 * Add audit log entry to buffer and emit a structured audit event immediately.
 * The immediate log is the durable fallback when there is no dedicated audit table.
 */
export function logAudit(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
        ...entry,
        timestamp: new Date(),
    };

    auditBuffer.push(fullEntry);

    logger.info("AUDIT_EVENT", safeAuditSummary(fullEntry));

    if (auditBuffer.length >= BUFFER_SIZE) {
        void flushAuditLogs();
    }
}

/**
 * Flush buffered audit logs.
 *
 * There is no database-backed sink available in this repo, so this flush is a
 * bounded in-memory checkpoint and batch summary only. If a real audit table is
 * added later, this function is the place to wire it in.
 */
export async function flushAuditLogs(): Promise<void> {
    if (auditBuffer.length === 0) return;

    const logsToFlush = auditBuffer.splice(0, auditBuffer.length);

    try {
        const first = logsToFlush[0];
        const last = logsToFlush[logsToFlush.length - 1];
        logger.info("AUDIT_BATCH_FLUSH", {
            audit: true,
            batchSize: logsToFlush.length,
            firstRequestId: first?.requestId,
            lastRequestId: last?.requestId,
            firstTimestamp: first?.timestamp.toISOString(),
            lastTimestamp: last?.timestamp.toISOString(),
        });
    } catch (error) {
        logger.error("Failed to flush audit logs", {}, error as Error);
        auditBuffer.unshift(...logsToFlush);
    }
}

flushTimer();

/**
 * Log tool call for audit.
 */
export function logToolCall(
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    context: {
        userId?: string;
        roomId?: string;
        requestId: string;
        ipAddress?: string;
    }
): void {
    const actionMap: Record<string, AuditAction> = {
        search_devices: "tool.device.search",
        get_device_details: "tool.device.view",
        search_issues: "tool.issue.search",
        get_notifications: "tool.notification.read",
        mark_notifications_read: "tool.notification.read",
    };

    const resultSummary = summarizeResult(result);

    logAudit({
        action: actionMap[toolName] || "chat.message.sent",
        userId: context.userId,
        roomId: context.roomId,
        requestId: context.requestId,
        details: {
            tool: toolName,
            params,
            result: resultSummary,
        },
        ipAddress: context.ipAddress,
        success: !!result,
    });
}

/**
 * Log AI response for audit.
 */
export function logAIResponse(
    query: string,
    intent: string,
    responseLength: number,
    context: {
        userId?: string;
        roomId?: string;
        requestId: string;
        latencyMs: number;
    }
): void {
    logAudit({
        action: "ai.response.generated",
        userId: context.userId,
        roomId: context.roomId,
        requestId: context.requestId,
        details: {
            intent,
            queryLength: query.length,
            responseLength,
            latencyMs: context.latencyMs,
        },
        success: true,
    });
}

/**
 * Log RAG context retrieval for audit.
 */
export function logRAGRetrieval(
    query: string,
    contextCount: number,
    sources: string[],
    requestId: string
): void {
    logAudit({
        action: "rag.context.retrieved",
        requestId,
        details: {
            queryLength: query.length,
            contextCount,
            sources,
        },
        success: true,
    });
}

function summarizeResult(result: unknown): Record<string, unknown> {
    if (result === null || result === undefined) {
        return { kind: String(result) };
    }

    if (Array.isArray(result)) {
        return {
            kind: "array",
            count: result.length,
            sample: sanitizeValue(result.slice(0, 3)),
        };
    }

    if (typeof result !== "object") {
        return {
            kind: typeof result,
            value: sanitizeValue(result),
        };
    }

    const objectValue = result as Record<string, unknown>;
    return {
        kind: "object",
        keys: Object.keys(objectValue).slice(0, MAX_AUDIT_OBJECT_KEYS),
        sample: sanitizeValue(objectValue),
    };
}
