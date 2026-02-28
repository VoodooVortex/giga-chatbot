/**
 * Chat Room Messages API
 * Get and create messages in a specific room
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { chatRooms, chatMessages, chatAttachments } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";

interface RouteParams {
    params: Promise<{
        roomId: string;
    }>;
}

// GET /api/chat/rooms/[roomId]/messages - Get room messages
export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { roomId } = await params;
        const cookieHeader = req.headers.get("cookie");
        const session = await getApiSession(cookieHeader);

        if (!session) {
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

        return NextResponse.json({ data: messages });
    } catch (error) {
        console.error("[Chat Messages API] Error:", error);
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
    try {
        const { roomId } = await params;
        const cookieHeader = req.headers.get("cookie");
        const session = await getApiSession(cookieHeader);

        if (!session) {
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

        return NextResponse.json({ data: message }, { status: 201 });
    } catch (error) {
        console.error("[Chat Messages API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
