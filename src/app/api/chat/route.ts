/**
 * Chat API Route with AI Orchestration
 * Uses LangGraph-based orchestration for intent classification, RAG, and tool calling
 */
import { NextRequest, NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/session";
import { orchestrate } from "@/lib/ai/orchestrator";

// Simple in-memory rate limiting (replace with Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 30;

  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Get session from cookie
    const cookieHeader = req.headers.get("cookie");
    const session = await getApiSession(cookieHeader);

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Please login to use the chat" },
        { status: 401 }
      );
    }

    // Rate limiting
    const rateLimitKey = session.user.id;
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json(
        { error: "Rate limit exceeded", message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await req.json();
    const { messages, roomId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Bad request", message: "Messages array is required" },
        { status: 400 }
      );
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      return NextResponse.json(
        { error: "Bad request", message: "Last message must be from user" },
        { status: 400 }
      );
    }

    // Build conversation history (last 5 messages for context)
    const conversationHistory = messages.slice(-6, -1).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }));

    // Run AI orchestration
    const result = await orchestrate({
      query: lastMessage.content,
      cookie: cookieHeader || undefined,
      conversationHistory,
      useHybridSearch: true
    });

    // Return response with metadata for debugging/UI
    return NextResponse.json({
      message: result.response,
      metadata: {
        intent: result.intent,
        sources: result.sources,
        requestId: crypto.randomUUID()
      }
    });

  } catch (error) {
    console.error("[Chat API] Error:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error occurred"
      },
      { status: 500 }
    );
  }
}

// SSE endpoint for streaming responses
export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie");
  const session = await getApiSession(cookieHeader);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // For now, return a simple message. Implement SSE streaming in future.
  return NextResponse.json({ status: "ok", message: "Chat API is running" });
}
