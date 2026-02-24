import { NextResponse } from "next/server";

/**
 * Health check endpoint for liveness probe
 * GET /chat/api/healthz
 */
export async function GET() {
    return NextResponse.json(
        {
            status: "healthy",
            service: "giga-chatbot",
            timestamp: new Date().toISOString(),
        },
        { status: 200 }
    );
}