/**
 * Room Chat API Route
 * Handles room-scoped AI chat and persists conversation history
 */
import { NextRequest, NextResponse } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { getApiSession } from "@/lib/auth/session";
import { orchestrate } from "@/lib/ai/orchestrator";
import { env } from "@/lib/config";
import { db } from "@/lib/db";
import { chatMessages, chatRooms } from "@/lib/db/schema";
import { logger } from "@/lib/observability/logger";
import { metrics, METRIC_NAMES } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    roomId: string;
  }>;
}

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
    return value
      .map((item) => extractMessageTextDeep(item, depth + 1))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const preferredKeys = ["content", "text", "parts", "value", "message"];

    for (const key of preferredKeys) {
      if (key in obj) {
        const extracted = extractMessageTextDeep(obj[key], depth + 1);
        if (extracted) return extracted;
      }
    }

    for (const nestedValue of Object.values(obj)) {
      const extracted = extractMessageTextDeep(nestedValue, depth + 1);
      if (extracted) return extracted;
    }
  }

  return "";
}

function toChatStreamResponse(text: string, metadata?: unknown): Response {
  const textPartId = crypto.randomUUID();

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata });
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

function buildUniqueRoomTitle(query: string, roomId: number): string {
  void roomId;
  const normalized = query.replace(/\s+/g, " ").trim();
  const short = normalized.slice(0, 56).trim();
  if (!short) {
    return "บทสนทนาใหม่";
  }
  return `${short}${normalized.length > 56 ? "..." : ""}`;
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

export async function POST(req: NextRequest, { params }: RouteParams) {
  const requestId = getRequestId(req);
  const startTime = Date.now();
  const route = "/api/chat/rooms/[roomId]";

  try {
    const { roomId } = await params;
    const roomIdNum = Number.parseInt(roomId, 10);

    if (!Number.isFinite(roomIdNum)) {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, { requestId });
      return NextResponse.json({ error: "Bad request", message: "Invalid room id" }, { status: 400 });
    }

    const cookieHeader = req.headers.get("cookie");
    const authorizationHeader = req.headers.get("authorization");
    const session = await getApiSession(cookieHeader, authorizationHeader);

    if (!session) {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 401, latencyMs);
      logger.logRequest("POST", route, 401, latencyMs, { requestId });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [room] = await db
      .select({
        cr_id: chatRooms.cr_id,
        cr_title: chatRooms.cr_title,
      })
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.cr_id, roomIdNum),
          eq(chatRooms.cr_us_id, Number.parseInt(session.user.id, 10)),
        ),
      )
      .limit(1);

    if (!room) {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 404, latencyMs);
      logger.logRequest("POST", route, 404, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomIdNum),
      });
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomIdNum),
      });
      return NextResponse.json(
        { error: "Bad request", message: "Messages array is required" },
        { status: 400 },
      );
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomIdNum),
      });
      return NextResponse.json(
        { error: "Bad request", message: "Last message must be from user" },
        { status: 400 },
      );
    }

    const userQuery = extractMessageTextDeep(lastMessage);
    if (!userQuery) {
      const latencyMs = Date.now() - startTime;
      recordRequestMetric("POST", route, 400, latencyMs);
      logger.logRequest("POST", route, 400, latencyMs, {
        requestId,
        userId: session.user.id,
        roomId: String(roomIdNum),
      });
      return NextResponse.json(
        { error: "Bad request", message: "Last user message content is required" },
        { status: 400 },
      );
    }

    const conversationHistory = messages
      .slice(-10, -1)
      .map((m: { role: string; content: unknown }) => ({
        role: m.role as "user" | "assistant",
        content: extractMessageTextDeep(m),
      }))
      .filter((m) => m.content.length > 0);

    const [latestStoredMessage] = await db
      .select({ cm_role: chatMessages.cm_role, cm_content: chatMessages.cm_content })
      .from(chatMessages)
      .where(eq(chatMessages.cm_cr_id, roomIdNum))
      .orderBy(desc(chatMessages.created_at))
      .limit(1);

    if (
      !latestStoredMessage ||
      latestStoredMessage.cm_role !== "user" ||
      latestStoredMessage.cm_content !== userQuery
    ) {
      await db.insert(chatMessages).values({
        cm_cr_id: roomIdNum,
        cm_role: "user",
        cm_content: userQuery,
        cm_status: "ok",
      });
    }

    const normalizedTitle = (room.cr_title || "").trim();
    const shouldGenerateTitle =
      !normalizedTitle ||
      normalizedTitle === "แชทใหม่" ||
      normalizedTitle.toLowerCase() === "new chat";

    if (shouldGenerateTitle) {
      await db
        .update(chatRooms)
        .set({
          cr_title: buildUniqueRoomTitle(userQuery, roomIdNum),
          updated_at: new Date(),
        })
        .where(eq(chatRooms.cr_id, roomIdNum));
    } else {
      await db
        .update(chatRooms)
        .set({ updated_at: new Date() })
        .where(eq(chatRooms.cr_id, roomIdNum));
    }

    const result = await orchestrateWithTimeout(
      {
        query: userQuery,
        cookie: cookieHeader || undefined,
        requestId,
        conversationHistory,
        useHybridSearch: env.ENABLE_RAG_HYBRID_SEARCH,
      },
      env.AI_TIMEOUT_MS,
    );

    await db.insert(chatMessages).values({
      cm_cr_id: roomIdNum,
      cm_role: "assistant",
      cm_content: result.response,
      cm_status: result.intent === "blocked" ? "blocked" : "ok",
    });

    const latencyMs = Date.now() - startTime;
    recordRequestMetric("POST", route, 200, latencyMs);
    metrics.counter(METRIC_NAMES.CHAT_MESSAGES_TOTAL, {
      route: "room",
      intent: result.intent,
      status: "ok",
    });
    logger.logRequest("POST", route, 200, latencyMs, {
      requestId,
      userId: session.user.id,
      roomId: String(roomIdNum),
      intent: result.intent,
    });

    return toChatStreamResponse(result.response, {
      intent: result.intent,
      responsePath: result.responsePath,
      timings: result.timings,
      sources: result.sources,
      roomId: roomIdNum,
      requestId: result.requestId,
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    recordRequestMetric("POST", route, 500, latencyMs);
    logger.error("[Room Chat API] Error", { requestId }, error as Error);
    logger.logRequest("POST", route, 500, latencyMs, { requestId });
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    );
  }
}
