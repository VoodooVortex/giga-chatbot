import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";

/**
 * Session check endpoint
 * Returns current user session info or 401
 * GET /chat/api/auth/session
 */
export async function GET(request: NextRequest) {
    const cookieHeader = request.headers.get("cookie");
    const authorizationHeader = request.headers.get("authorization");
    const session = await getApiSession(cookieHeader, authorizationHeader);

    if (!session) {
        return NextResponse.json(
            {
                error: "Unauthorized",
                code: "UNAUTHENTICATED",
                message: "No valid session found",
            },
            { status: 401 }
        );
    }

    return NextResponse.json({
        user: session.user,
        exp: session.expiresAt,
    });
}
