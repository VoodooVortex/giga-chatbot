/**
 * Chat Rooms API
 * Manage chat rooms and their messages
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { chatRooms, chatMessages } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";

// GET /api/chat/rooms - List user's chat rooms
export async function GET(req: NextRequest) {
    try {
        const cookieHeader = req.headers.get("cookie");
        const session = await getApiSession(cookieHeader);

        if (!session) {
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
            .orderBy(desc(chatRooms.updated_at));

        return NextResponse.json({ data: rooms });
    } catch (error) {
        console.error("[Chat Rooms API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/chat/rooms - Create a new chat room
export async function POST(req: NextRequest) {
    try {
        const cookieHeader = req.headers.get("cookie");
        const session = await getApiSession(cookieHeader);

        if (!session) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const { title } = body;

        const [room] = await db
            .insert(chatRooms)
            .values({
                cr_us_id: parseInt(session.user.id),
                cr_title: title || null,
            })
            .returning();

        return NextResponse.json({ data: room }, { status: 201 });
    } catch (error) {
        console.error("[Chat Rooms API] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
