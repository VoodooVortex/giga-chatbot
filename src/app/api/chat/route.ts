/**
 * Chat API Route with AI Orchestration
 * Uses LangGraph-based orchestration for intent classification, RAG, and tool calling
 */
import { NextRequest, NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { getApiSession } from "@/lib/auth/session";
import { buildCookieHeaderFromToken, extractTokenFromAuthorizationHeader } from "@/lib/auth/jwt";
import { orchestrate } from "@/lib/ai/orchestrator";
import { env } from "@/lib/config";
import { db } from "@/lib/db";
import { logger } from "@/lib/observability/logger";
import { metrics, METRIC_NAMES } from "@/lib/observability/metrics";
export const dynamic = "force-dynamic";

import { chatMessages, chatRooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function buildRoomTitle(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  const short = normalized.slice(0, 56).trim();
  return short ? `${short}${normalized.length > 56 ? "..." : ""}` : "บทสนทนาใหม่";
}

// Simple in-memory rate limiting (replace with Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
let aiQuotaCooldownUntil = 0;

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();

    return parts;
  }

  if (content && typeof content === "object") {
    const maybeText = (content as { text?: unknown; content?: unknown }).text;
    if (typeof maybeText === "string") return maybeText.trim();

    const maybeContent = (content as { content?: unknown }).content;
    if (typeof maybeContent === "string") return maybeContent.trim();
  }

  return "";
}

function extractMessageTextDeep(value: unknown, depth = 0): string {
  if (depth > 5) return "";

  const direct = extractMessageText(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    const combined = value
      .map((item) => extractMessageTextDeep(item, depth + 1))
      .filter(Boolean)
      .join(" ")
      .trim();
    return combined;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Try common message keys first
    const preferredKeys = ["content", "text", "parts", "value", "message"];
    for (const key of preferredKeys) {
      if (key in obj) {
        const extracted = extractMessageTextDeep(obj[key], depth + 1);
        if (extracted) return extracted;
      }
    }

    // Fallback: search all object values
    for (const nestedValue of Object.values(obj)) {
      const extracted = extractMessageTextDeep(nestedValue, depth + 1);
      if (extracted) return extracted;
    }
  }

  return "";
}

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

function toChatStreamResponse(text: string, metadata?: unknown): Response {
  const textPartId = crypto.randomUUID();

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageMetadata: metadata,
      });
      writer.write({ type: "text-start", id: textPartId });
      writer.write({ type: "text-delta", id: textPartId, delta: text });
      writer.write({ type: "text-end", id: textPartId });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: metadata,
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function getRequestId(req: NextRequest): string {
  return req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

function recordRequestMetric(
  method: string,
  route: string,
  status: number,
  latencyMs: number,
): void {
  const labels = { method, route, status: String(status) };
  metrics.counter(METRIC_NAMES.API_REQUESTS_TOTAL, labels);
  metrics.histogram(METRIC_NAMES.API_REQUEST_DURATION, latencyMs, labels);
}

function parseRetryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");

  // Example: "Please retry in 30.49687401s"
  const retryInMatch = message.match(/retry\s+in\s+([\d.]+)s/i);
  if (retryInMatch?.[1]) {
    const secs = Number.parseFloat(retryInMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.ceil(secs * 1000);
    }
  }

  // Example in details: "retryDelay":"45s"
  const retryDelayMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (retryDelayMatch?.[1]) {
    const secs = Number.parseInt(retryDelayMatch[1], 10);
    if (Number.isFinite(secs) && secs > 0) {
      return secs * 1000;
    }
  }

  return null;
}

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;

  return (
    status === 429 ||
    /too\s+many\s+requests/i.test(message) ||
    /quota\s+exceeded/i.test(message) ||
    /rate\s*limits?/i.test(message)
  );
}

async function orchestrateWithTimeout(
  params: Parameters<typeof orchestrate>[0],
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof orchestrate>>> {
  return Promise.race([
    orchestrate(params),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("AI orchestration timed out"));
      }, timeoutMs);
    }),
  ]);
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const startedAt = Date.now();
  const route = "/api/chat";

  try {
    // Get session from cookie
    const cookieHeader = req.headers.get("cookie");
    const authorizationHeader = req.headers.get("authorization");
    const session = await getApiSession(cookieHeader, authorizationHeader);

    if (!session) {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 401, latencyMs);
      logger.logRequest("POST", route, 401, latencyMs, { requestId });
      return NextResponse.json(
        { error: "Unauthorized", message: "Please login to use the chat" },
        { status: 401 }
      );
    }

    // Rate limiting
    const rateLimitKey = session.user.id;
    if (!checkRateLimit(rateLimitKey)) {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 429, latencyMs);
      logger.logRequest("POST", route, 429, latencyMs, {
        requestId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: "Rate limit exceeded", message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: "Bad request", message: "Messages array is required" },
        { status: 400 }
      );
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: "Bad request", message: "Last message must be from user" },
        { status: 400 }
      );
    }

    const userQuery = extractMessageTextDeep(lastMessage);
    if (!userQuery) {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: "Bad request", message: "Last user message content is required" },
        { status: 400 }
      );
    }

    // Create a chat room and persist the user message immediately
    const userId = Number.parseInt(session.user.id, 10);
    const [newRoom] = await db
      .insert(chatRooms)
      .values({ cr_us_id: userId, cr_title: buildRoomTitle(userQuery), updated_at: new Date() })
      .returning({ cr_id: chatRooms.cr_id });
    const roomId = newRoom!.cr_id;
    await db.insert(chatMessages).values({
      cm_cr_id: roomId,
      cm_role: "user",
      cm_content: userQuery,
      cm_status: "ok",
    });

    // Build conversation history (last 5 messages for context)
    const conversationHistory = messages
      .slice(-6, -1)
      .map((m: { role: string; content: unknown }) => ({
        role: m.role as "user" | "assistant",
        content: extractMessageTextDeep(m),
      }))
      .filter((m) => m.content.length > 0);

    // Gemini quota cooldown guard (avoid hammering provider during 429 window)
    const now = Date.now();
    if (now < aiQuotaCooldownUntil) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((aiQuotaCooldownUntil - now) / 1000),
      );
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 200, latencyMs);
      logger.logRequest("POST", route, 200, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomId),
        intent: "fallback",
        responsePath: "fallback",
        reason: "quota_cooldown",
      });
      return toChatStreamResponse(
        `ขออภัย โควต้า AI ชั่วคราวเต็ม กรุณาลองใหม่อีกครั้งในประมาณ ${retryAfterSec} วินาที`,
        {
          intent: "fallback",
          responsePath: "fallback",
          degraded: true,
          reason: "quota_cooldown",
          retryAfterSec,
          requestId,
        },
      );
    }

    // Run AI orchestration
    const tokenFromAuth = extractTokenFromAuthorizationHeader(authorizationHeader);
    const authCookieHeader =
      cookieHeader || (tokenFromAuth ? buildCookieHeaderFromToken(tokenFromAuth) : null);

    let result: Awaited<ReturnType<typeof orchestrate>>;
    try {
      result = await orchestrateWithTimeout(
        {
          query: userQuery,
          cookie: authCookieHeader || undefined,
          requestId,
          conversationHistory,
          useHybridSearch: env.ENABLE_RAG_HYBRID_SEARCH,
        },
        env.AI_TIMEOUT_MS,
      );
    } catch (error) {
      console.error("[Chat API] Orchestration failed or timed out:", error);

      if (isQuotaExceededError(error)) {
        const retryDelayMs = parseRetryDelayMs(error) ?? 30_000;
        aiQuotaCooldownUntil = Date.now() + retryDelayMs;
        const retryAfterSec = Math.max(1, Math.ceil(retryDelayMs / 1000));
        const latencyMs = Date.now() - startedAt;
        recordRequestMetric("POST", route, 200, latencyMs);
        logger.logRequest("POST", route, 200, latencyMs, {
          requestId,
          userId: session.user.id,
          roomId: String(roomId),
          intent: "fallback",
          responsePath: "fallback",
          reason: "quota_exceeded",
        });

        return toChatStreamResponse(
          `ขออภัย โควต้า AI เต็มชั่วคราว กรุณาลองใหม่อีกครั้งในประมาณ ${retryAfterSec} วินาที`,
          {
            intent: "fallback",
            responsePath: "fallback",
            degraded: true,
            reason: "quota_exceeded",
            retryAfterSec,
            requestId,
          },
        );
      }

      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 200, latencyMs);
      logger.logRequest("POST", route, 200, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomId),
        intent: "fallback",
        responsePath: "fallback",
        reason: "orchestration_error",
      });
      return toChatStreamResponse(
        "ขออภัย ระบบ AI ตอบช้ากว่าปกติในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่",
        {
          intent: "fallback",
          responsePath: "fallback",
          degraded: true,
          requestId,
        },
      );
    }

    // Check if content was blocked by guardrails
    if (result.intent === "blocked") {
      const latencyMs = Date.now() - startedAt;
      recordRequestMetric("POST", route, 200, latencyMs);
      logger.logRequest("POST", route, 200, latencyMs, {
        requestId: result.requestId,
        userId: session.user.id,
        roomId: String(roomId),
        intent: result.intent,
        responsePath: result.responsePath,
      });
      return toChatStreamResponse(result.response, {
        intent: "blocked",
        responsePath: result.responsePath,
        blocked: true,
        violation: result.safetyResult?.violation,
        level: result.safetyResult?.level,
        timings: result.timings,
        requestId: result.requestId,
      });
    }

    // Persist assistant response and bump updated_at so the room sorts to top
    await db.insert(chatMessages).values({
      cm_cr_id: roomId,
      cm_role: "assistant",
      cm_content: result.response,
      cm_status: result.intent === "blocked" ? "blocked" : "ok",
    });
    await db
      .update(chatRooms)
      .set({ updated_at: new Date() })
      .where(eq(chatRooms.cr_id, roomId));

    const latencyMs = Date.now() - startedAt;
    recordRequestMetric("POST", route, 200, latencyMs);
    metrics.counter(METRIC_NAMES.CHAT_MESSAGES_TOTAL, {
      route: "new-room",
      intent: result.intent,
      path: result.responsePath,
      status: "ok",
    });
    logger.logRequest("POST", route, 200, latencyMs, {
      requestId: result.requestId,
      userId: session.user.id,
      roomId: String(roomId),
      intent: result.intent,
      responsePath: result.responsePath,
    });

    // Return response — include roomId so the client can navigate to the new room
    return toChatStreamResponse(result.response, {
      intent: result.intent,
      responsePath: result.responsePath,
      timings: result.timings,
      sources: result.sources,
      roomId,
      requestId: result.requestId,
    });

  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    recordRequestMetric("POST", route, 500, latencyMs);
    logger.error("[Chat API] Error", { requestId }, error as Error);
    logger.logRequest("POST", route, 500, latencyMs, { requestId });

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
  const requestId = getRequestId(req);
  const startedAt = Date.now();
  const route = "/api/chat";
  const cookieHeader = req.headers.get("cookie");
  const authorizationHeader = req.headers.get("authorization");
  const session = await getApiSession(cookieHeader, authorizationHeader);

  if (!session) {
    const latencyMs = Date.now() - startedAt;
    recordRequestMetric("GET", route, 401, latencyMs);
    logger.logRequest("GET", route, 401, latencyMs, { requestId });
    return new Response("Unauthorized", { status: 401 });
  }

  // For now, return a simple message. Implement SSE streaming in future.
  const latencyMs = Date.now() - startedAt;
  recordRequestMetric("GET", route, 200, latencyMs);
  logger.logRequest("GET", route, 200, latencyMs, {
    requestId,
    userId: session.user.id,
  });
  return NextResponse.json({ status: "ok", message: "Chat API is running", requestId });
}
