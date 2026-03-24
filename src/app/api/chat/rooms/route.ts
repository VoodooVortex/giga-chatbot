/**
 * Chat Rooms API
 * Manage chat rooms and their messages
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { chatRooms, chatMessages } from "@/lib/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { logger } from "@/lib/observability/logger";
import { metrics, METRIC_NAMES } from "@/lib/observability/metrics";

// GET /api/chat/rooms - List user's chat rooms
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

export async function GET(req: NextRequest) {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const route = "/api/chat/rooms";

    try {
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

        const rooms = await db
            .select({
                cr_id: chatRooms.cr_id,
                cr_title: chatRooms.cr_title,
                created_at: chatRooms.created_at,
                updated_at: chatRooms.updated_at,
            })
            .from(chatRooms)
            .where(eq(chatRooms.cr_us_id, parseInt(session.user.id)))
            // COALESCE so rooms without updated_at fall back to created_at
            // instead of sorting as NULL (which PostgreSQL puts first in DESC)
            .orderBy(sql`COALESCE(${chatRooms.updated_at}, ${chatRooms.created_at}) DESC`);

        const roomsWithPreviewRaw = await Promise.all(
            rooms.map(async (room) => {
                const [lastUserMessage] = await db
                    .select({
                        cm_content: chatMessages.cm_content,
                    })
                    .from(chatMessages)
                    .where(
                        and(
                            eq(chatMessages.cm_cr_id, room.cr_id),
                            eq(chatMessages.cm_role, "user")
                        )
                    )
                    .orderBy(desc(chatMessages.created_at))
                    .limit(1);

                const normalizedTitle = (room.cr_title || "").trim();
                const isDefaultTitle =
                    !normalizedTitle ||
                    normalizedTitle === "แชทใหม่" ||
                    normalizedTitle.toLowerCase() === "new chat";

                const previewTitle = isDefaultTitle
                    ? lastUserMessage?.cm_content?.trim().slice(0, 80) || null
                    : normalizedTitle;

                // Do not show empty rooms in history (user has not started chatting yet)
                if (!previewTitle) {
                    return null;
                }

                return {
                    ...room,
                    cr_title: isDefaultTitle ? null : room.cr_title,
                    preview_title: previewTitle,
                };
            })
        );

        const roomsWithPreview = roomsWithPreviewRaw.filter(
            (room): room is NonNullable<typeof room> => room !== null
        );

        const latencyMs = Date.now() - startTime;
        recordRequestMetric("GET", route, 200, latencyMs);
        logger.logRequest("GET", route, 200, latencyMs, {
            requestId,
            userId: session.user.id,
            roomCount: roomsWithPreview.length,
        });

        return NextResponse.json({ data: roomsWithPreview });
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        recordRequestMetric("GET", route, 500, latencyMs);
        logger.error("[Chat Rooms API] Error", { requestId }, error as Error);
        logger.logRequest("GET", route, 500, latencyMs, { requestId });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/chat/rooms - Create a new chat room
export async function POST(req: NextRequest) {
    const requestId = getRequestId(req);
    const startTime = Date.now();
    const route = "/api/chat/rooms";

    try {
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

        const body = await req.json();
        const { title } = body;
        const normalizedTitle = typeof title === "string" ? title.trim() : null;

        const [room] = await db
            .insert(chatRooms)
            .values({
                cr_us_id: parseInt(session.user.id),
                cr_title: normalizedTitle || null,
            })
            .returning();

        const latencyMs = Date.now() - startTime;
        recordRequestMetric("POST", route, 201, latencyMs);
        logger.logRequest("POST", route, 201, latencyMs, {
            requestId,
            userId: session.user.id,
            roomId: String(room.cr_id),
        });

        return NextResponse.json({ data: room }, { status: 201 });
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        recordRequestMetric("POST", route, 500, latencyMs);
        logger.error("[Chat Rooms API] Error", { requestId }, error as Error);
        logger.logRequest("POST", route, 500, latencyMs, { requestId });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
