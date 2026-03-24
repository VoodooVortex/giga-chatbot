/**
 * Chat Room Messages API
 * Get and create messages in a specific room
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { chatRooms, chatMessages } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { logger } from "@/lib/observability/logger";
import { metrics, METRIC_NAMES } from "@/lib/observability/metrics";

interface RouteParams {
    params: Promise<{
        roomId: string;
    }>;
}

// GET /api/chat/rooms/[roomId]/messages - Get room messages
export const dynamic = "force-dynamic";

function getRequestId(req: NextRequest): string {
    return req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

function recordRequestMetric(
    method: string,
    route: string,
    status: number,
    latencyMs: number
): void {
    const labels = { method, route, status: String(status) };
    metrics.counter(METRIC_NAMES.API_REQUESTS_TOTAL, labels);
    metrics.histogram(METRIC_NAMES.API_REQUEST_DURATION, latencyMs, labels);
}

export async function GET(
    req: NextRequest,
    { params }: RouteParams
) {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const route = "/api/chat/rooms/[roomId]/messages";

    try {
        const { roomId } = await params;
        const cookieHeader = req.headers.get("cookie");
        const authorizationHeader = req.headers.get("authorization");
        const session = await getApiSession(cookieHeader, authorizationHeader);

        if (!session) {
            const latencyMs = Date.now() - startTime;
            recordRequestMetric("GET", route, 401, latencyMs);
            logger.logRequest("GET", route, 401, latencyMs, { requestId });
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Verify room ownership
        const [room] = await db
            .select()
            .from(chatRooms)
            .where(
                and(
                    eq(chatRooms.cr_id, parseInt(roomId)),
                    eq(chatRooms.cr_us_id, parseInt(session.user.id))
                )
            )
            .limit(1);

        if (!room) {
            const latencyMs = Date.now() - startTime;
            recordRequestMetric("GET", route, 404, latencyMs);
            logger.logRequest("GET", route, 404, latencyMs, {
                requestId,
                userId: session.user.id,
                roomId,
            });
            return NextResponse.json(
                { error: "Room not found" },
                { status: 404 }
            );
        }

        // Get messages with attachments
        const messages = await db
            .select({
                cm_id: chatMessages.cm_id,
                cm_role: chatMessages.cm_role,
                cm_content: chatMessages.cm_content,
                cm_content_json: chatMessages.cm_content_json,
                cm_status: chatMessages.cm_status,
                cm_parent_id: chatMessages.cm_parent_id,
                created_at: chatMessages.created_at,
            })
            .from(chatMessages)
            .where(eq(chatMessages.cm_cr_id, parseInt(roomId)))
            .orderBy(desc(chatMessages.created_at));

        const latencyMs = Date.now() - startTime;
        recordRequestMetric("GET", route, 200, latencyMs);
        logger.logRequest("GET", route, 200, latencyMs, {
            requestId,
            userId: session.user.id,
            roomId,
            messageCount: messages.length,
        });

        return NextResponse.json({ data: messages });
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        recordRequestMetric("GET", route, 500, latencyMs);
        logger.error("[Chat Messages API] Error", { requestId }, error as Error);
        logger.logRequest("GET", route, 500, latencyMs, { requestId });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/chat/rooms/[roomId]/messages - Create a message
export async function POST(
    req: NextRequest,
    { params }: RouteParams
) {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const route = "/api/chat/rooms/[roomId]/messages";

    try {
        const { roomId } = await params;
        const cookieHeader = req.headers.get("cookie");
        const authorizationHeader = req.headers.get("authorization");
        const session = await getApiSession(cookieHeader, authorizationHeader);

        if (!session) {
            const latencyMs = Date.now() - startTime;
            recordRequestMetric("POST", route, 401, latencyMs);
            logger.logRequest("POST", route, 401, latencyMs, { requestId });
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Verify room ownership
        const [room] = await db
            .select()
            .from(chatRooms)
            .where(
                and(
                    eq(chatRooms.cr_id, parseInt(roomId)),
                    eq(chatRooms.cr_us_id, parseInt(session.user.id))
                )
            )
            .limit(1);

        if (!room) {
            const latencyMs = Date.now() - startTime;
            recordRequestMetric("POST", route, 404, latencyMs);
            logger.logRequest("POST", route, 404, latencyMs, {
                requestId,
                userId: session.user.id,
                roomId,
            });
            return NextResponse.json(
                { error: "Room not found" },
                { status: 404 }
            );
        }

        const body = await req.json();
        const { content, role = "user", parent_id } = body;

        const [message] = await db
            .insert(chatMessages)
            .values({
                cm_cr_id: parseInt(roomId),
                cm_role: role,
                cm_content: content,
                cm_parent_id: parent_id || null,
                cm_status: "ok",
            })
            .returning();

        // Update room's updated_at timestamp
        await db
            .update(chatRooms)
            .set({ updated_at: new Date() })
            .where(eq(chatRooms.cr_id, parseInt(roomId)));

        const latencyMs = Date.now() - startTime;
        recordRequestMetric("POST", route, 201, latencyMs);
        metrics.counter(METRIC_NAMES.CHAT_MESSAGES_TOTAL, {
            route: "messages",
            role: String(role),
            status: "ok",
        });
        logger.logRequest("POST", route, 201, latencyMs, {
            requestId,
            userId: session.user.id,
            roomId,
            messageId: String(message.cm_id),
        });

        return NextResponse.json({ data: message }, { status: 201 });
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        recordRequestMetric("POST", route, 500, latencyMs);
        logger.error("[Chat Messages API] Error", { requestId }, error as Error);
        logger.logRequest("POST", route, 500, latencyMs, { requestId });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
