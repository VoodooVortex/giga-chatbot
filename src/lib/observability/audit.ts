/**
 * Audit Logging
 * Track important actions for compliance and security
 */

import { db } from "@/lib/db";
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

// In-memory buffer for batch inserts
const auditBuffer: AuditLogEntry[] = [];
const BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;

/**
 * Add audit log entry to buffer
 */
export function logAudit(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
        ...entry,
        timestamp: new Date(),
    };

    auditBuffer.push(fullEntry);

    // Flush if buffer is full
    if (auditBuffer.length >= BUFFER_SIZE) {
        flushAuditLogs();
    }

    // Also log to regular logger
    logger.info("AUDIT", {
        action: entry.action,
        userId: entry.userId,
        roomId: entry.roomId,
        requestId: entry.requestId,
        success: entry.success,
    });
}

/**
 * Flush audit logs to database
 */
export async function flushAuditLogs(): Promise<void> {
    if (auditBuffer.length === 0) return;

    const logsToFlush = [...auditBuffer];
    auditBuffer.length = 0;

    try {
        // Insert to database
        // Note: This requires an audit_logs table to be created
        // For now, just log to console
        logger.info(`Flushing ${logsToFlush.length} audit logs`);

        // In production, insert to database:
        // await db.insert(auditLogsTable).values(logsToFlush);
    } catch (error) {
        logger.error("Failed to flush audit logs", {}, error as Error);
        // Put back in buffer for retry
        auditBuffer.unshift(...logsToFlush);
    }
}

// Auto-flush every 5 seconds
setInterval(flushAuditLogs, FLUSH_INTERVAL_MS);

/**
 * Log tool call for audit
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

    logAudit({
        action: actionMap[toolName] || "chat.message.sent",
        userId: context.userId,
        roomId: context.roomId,
        requestId: context.requestId,
        details: {
            tool: toolName,
            params,
            result: result ? "success" : "error",
        },
        ipAddress: context.ipAddress,
        success: !!result,
    });
}

/**
 * Log AI response for audit
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
 * Log RAG context retrieval for audit
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
