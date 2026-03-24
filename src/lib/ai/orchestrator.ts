/**
 * AI Orchestrator using LangGraph pattern
 * Coordinates intent classification, RAG retrieval, tool calling, and response generation
 * Includes content safety guardrails
 */

import { classifyIntent } from "./intent-classifier";
import {
  retrieveRAGContextWithTelemetry,
  retrieveHybridContextWithTelemetry,
  type RAGRetrievalResult,
  type RAGRetrievalTelemetry,
} from "./rag-retriever";
import { executeTool, executeToolCalls } from "./tools";
import { generateResponse } from "./response-generator";
import { runSafetyChecks, getBlockedResponse } from "@/lib/safety/guardrails";
import { env } from "@/lib/config";
import { logger } from "@/lib/observability/logger";
import { logAIResponse } from "@/lib/observability/audit";
import { metrics, METRIC_NAMES } from "@/lib/observability/metrics";
import type { ClassifiedIntent, RAGContext, ToolCall } from "./types";
import type { SafetyCheckResult } from "@/lib/safety/guardrails";

type ResponsePath =
  | "blocked"
  | "clarification"
  | "deterministic_list"
  | "deterministic_notification"
  | "deterministic_asset"
  | "deterministic_availability"
  | "llm"
  | "fallback";

interface PipelineTimings {
  safetyMs: number;
  intentMs: number;
  ragMs: number;
  toolMs: number;
  responseMs: number;
  totalMs: number;
}

interface OrchestratorOptions {
  query: string;
  cookie?: string;
  requestId?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  useHybridSearch?: boolean;
  skipSafetyCheck?: boolean;
}

interface OrchestratorResult {
  response: string;
  intent: string;
  requestId: string;
  responsePath: ResponsePath;
  timings: PipelineTimings;
  telemetry?: {
    rag?: RAGRetrievalTelemetry;
    toolCount: number;
    toolErrors: number;
  };
  sources: {
    rag?: RAGContext[];
    tools?: ToolCall[];
  };
  safetyResult?: SafetyCheckResult;
}

/**
 * Main orchestration function
 * Runs the complete AI pipeline: Intent → RAG → Tools → Response
 */
export async function orchestrate(
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const {
    query,
    cookie,
    requestId,
    conversationHistory,
    useHybridSearch = true,
    skipSafetyCheck = false,
  } = options;
  const pipelineStartedAt = Date.now();
  const resolvedRequestId = requestId ?? crypto.randomUUID();
  const requestLogger = logger.child({ requestId: resolvedRequestId });
  const timings: PipelineTimings = createEmptyTimings();
  let responsePath: ResponsePath = "llm";
  let finalIntent = "general_question";
  let finalSources: { rag?: RAGContext[]; tools?: ToolCall[] } = {};

  // Step 0: Content Safety Check
  if (!skipSafetyCheck) {
    requestLogger.info("[AI Orchestrator] Step 0: Running content safety checks");
    const safetyStartedAt = Date.now();
    const safetyResult = runSafetyChecks(query);
    timings.safetyMs = Date.now() - safetyStartedAt;

    if (!safetyResult.isSafe) {
      const response = getBlockedResponse(safetyResult.violation || "unknown");
      responsePath = "blocked";
      finalIntent = "blocked";
      timings.totalMs = Date.now() - pipelineStartedAt;
      return finalizeOrchestratorResult({
        requestId: resolvedRequestId,
        query,
        intent: finalIntent,
        response,
        responsePath,
        timings,
        sources: finalSources,
        safetyResult,
      });
    }

    requestLogger.info("[AI Orchestrator] Content safety checks passed", {
      safetyMs: timings.safetyMs,
    });
  }

  // Step 1: Classify Intent
  requestLogger.info("[AI Orchestrator] Step 1: Classifying intent");
  const intentStartedAt = Date.now();
  const intent = await classifyIntent(query);
  timings.intentMs = Date.now() - intentStartedAt;
  finalIntent = intent.intent;
  requestLogger.info("[AI Orchestrator] Intent classified", {
    intent: intent.intent,
    confidence: intent.confidence,
    intentMs: timings.intentMs,
  });

  const clarification = getClarificationResponse(intent, query);
  if (clarification) {
    responsePath = "clarification";
    timings.totalMs = Date.now() - pipelineStartedAt;
    return finalizeOrchestratorResult({
      requestId: resolvedRequestId,
      query,
      intent: "clarification",
      response: clarification,
      responsePath,
      timings,
      sources: finalSources,
    });
  }

  // Step 2: Parallel execution based on intent
  const ragStartedAt = Date.now();
  const toolStartedAt = Date.now();
  const [ragResult, toolResults] = await Promise.all([
    // RAG Retrieval (for general questions)
    shouldUseRAG(intent.intent)
      ? retrieveContextWithTelemetry(query, useHybridSearch, resolvedRequestId)
      : Promise.resolve(null),

    // Tool Execution (for specific intents)
    shouldUseTools(intent.intent)
      ? executeToolsForIntent(intent, query, cookie, resolvedRequestId)
      : Promise.resolve([]),
  ]);

  const ragTelemetry = ragResult?.telemetry;
  const ragContexts = ragResult?.contexts ?? [];
  timings.ragMs = shouldUseRAG(intent.intent)
    ? ragTelemetry?.durationMs ?? Date.now() - ragStartedAt
    : 0;
  timings.toolMs = shouldUseTools(intent.intent) ? Date.now() - toolStartedAt : 0;

  finalSources = {
    rag: ragContexts.length > 0 ? ragContexts : undefined,
    tools: toolResults.length > 0 ? toolResults : undefined,
  };

  requestLogger.info("[AI Orchestrator] Retrieval and tools complete", {
    ragCount: ragContexts.length,
    toolCount: toolResults.length,
    ragMs: timings.ragMs,
    toolMs: timings.toolMs,
    topSimilarity: ragTelemetry?.topSimilarity,
    averageSimilarity: ragTelemetry?.averageSimilarity,
    zeroHit: ragTelemetry?.zeroHit,
  });

  const deterministicResponse = buildDeterministicListResponse(query, toolResults);
  if (deterministicResponse) {
    responsePath = "deterministic_list";
    timings.responseMs = 0;
    timings.totalMs = Date.now() - pipelineStartedAt;
    return finalizeOrchestratorResult({
      requestId: resolvedRequestId,
      query,
      intent: intent.intent,
      response: deterministicResponse,
      responsePath,
      timings,
      sources: finalSources,
      ragTelemetry,
    });
  }

  const notificationResponse = buildDeterministicNotificationResponse(
    intent.intent,
    query,
    toolResults,
  );
  if (notificationResponse) {
    responsePath = "deterministic_notification";
    timings.totalMs = Date.now() - pipelineStartedAt;
    return finalizeOrchestratorResult({
      requestId: resolvedRequestId,
      query,
      intent: intent.intent,
      response: notificationResponse,
      responsePath,
      timings,
      sources: finalSources,
      ragTelemetry,
    });
  }

  const assetResponse = buildDeterministicAssetResponse(
    intent.intent,
    query,
    toolResults,
  );
  if (assetResponse) {
    responsePath = "deterministic_asset";
    timings.totalMs = Date.now() - pipelineStartedAt;
    return finalizeOrchestratorResult({
      requestId: resolvedRequestId,
      query,
      intent: intent.intent,
      response: assetResponse,
      responsePath,
      timings,
      sources: finalSources,
      ragTelemetry,
    });
  }

  const availabilityResponse = buildDeterministicAvailabilityResponse(
    intent.intent,
    query,
    toolResults,
  );
  if (availabilityResponse) {
    responsePath = "deterministic_availability";
    timings.totalMs = Date.now() - pipelineStartedAt;
    return finalizeOrchestratorResult({
      requestId: resolvedRequestId,
      query,
      intent: intent.intent,
      response: availabilityResponse,
      responsePath,
      timings,
      sources: finalSources,
      ragTelemetry,
    });
  }

  // Step 3: Generate Response
  requestLogger.info("[AI Orchestrator] Step 3: Generating response");
  const responseStartedAt = Date.now();
  const response = await generateResponse({
    query,
    intent: intent.intent,
    ragContexts: ragContexts.length > 0 ? ragContexts : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    conversationHistory,
  });
  timings.responseMs = Date.now() - responseStartedAt;
  responsePath = "llm";
  timings.totalMs = Date.now() - pipelineStartedAt;

  return finalizeOrchestratorResult({
    requestId: resolvedRequestId,
    query,
    intent: intent.intent,
    response,
    responsePath,
    timings,
    sources: finalSources,
    ragTelemetry,
  });
}

/**
 * Determine if RAG should be used for this intent
 */
function shouldUseRAG(intent: string): boolean {
  // In low quota mode, only allow RAG for general questions (if enabled)
  if (env.LOW_QUOTA_MODE) {
    return intent === "general_question" && env.ENABLE_RAG_GENERAL_QUESTION;
  }

  if (intent === "general_question") {
    return env.ENABLE_RAG_GENERAL_QUESTION;
  }

  if (intent === "device_lookup") {
    return env.ENABLE_RAG_DEVICE_LOOKUP;
  }

  if (intent === "ticket_lookup") {
    return env.ENABLE_RAG_TICKET_LOOKUP;
  }

  return false;
}

/**
 * Determine if tools should be used for this intent
 */
function shouldUseTools(intent: string): boolean {
  // Tools are used for specific data lookups
  return ["device_lookup", "ticket_lookup", "notification_check"].includes(
    intent,
  );
}

/**
 * Retrieve context using RAG
 */
async function retrieveContext(
  query: string,
  useHybrid: boolean,
): Promise<RAGContext[]> {
  try {
    const result = await retrieveContextWithTelemetry(query, useHybrid);
    return result?.contexts ?? [];
  } catch (error) {
    console.error("[AI Orchestrator] RAG retrieval failed:", error);
    return [];
  }
}

async function retrieveContextWithTelemetry(
  query: string,
  useHybrid: boolean,
  requestId?: string,
): Promise<RAGRetrievalResult | null> {
  try {
    if (useHybrid) {
      return await retrieveHybridContextWithTelemetry(query, {
        topK: 5,
        minSimilarity: 0.6,
        requestId,
      });
    }

    return await retrieveRAGContextWithTelemetry(query, {
      topK: 5,
      minSimilarity: 0.7,
      requestId,
    });
  } catch (error) {
    console.error("[AI Orchestrator] RAG retrieval failed:", error);
    return null;
  }
}

/**
 * Execute tools based on intent and entities
 */
async function executeToolsForIntent(
  intent: ClassifiedIntent,
  query: string,
  cookie?: string,
  requestId?: string,
): Promise<ToolCall[]> {
  if (intent.intent === "device_lookup") {
    return executeDeviceLookupTools(intent, query, cookie, requestId);
  }

  switch (intent.intent) {
    case "ticket_lookup": {
      const params: Record<string, unknown> = { limit: 10 };

      if (intent.entities.ticketId) {
        params.q = intent.entities.ticketId;
      } else if (intent.entities.deviceId) {
        const deviceId = parseNumericId(intent.entities.deviceId);
        if (deviceId) {
          params.de_id = deviceId;
        }
      }

      return await executeToolCalls(
        [{ tool: "search_issues", params }],
        cookie,
        { requestId },
      );
    }

    case "notification_check": {
      const unreadOnly = wantsUnreadNotifications(query);
      return await executeToolCalls(
        [
          {
            tool: "get_notifications",
            params: { unread: unreadOnly ? true : false, limit: 20 },
          },
        ],
        cookie,
        { requestId },
      );
    }
  }

  return [];
}

async function executeDeviceLookupTools(
  intent: ClassifiedIntent,
  query: string,
  cookie?: string,
  requestId?: string,
): Promise<ToolCall[]> {
  const results: ToolCall[] = [];
  const wantsAvailability = isAvailabilityQuery(query);
  const wantsDetails = isDetailQuery(query);
  const wantsListAllAvailability = isListAllAvailabilityQuery(query);
  const wantsListAllDevices = isListAllDevicesQuery(query);
  const deviceId = parseNumericId(intent.entities.deviceId);
  const searchTerm = buildDeviceSearchTerm(query, intent);
  const assetCode = extractAssetCode(query);
  const dateRange = wantsAvailability ? extractDateRange(query) : null;

  if (assetCode) {
    const assetResult = await safeExecuteTool(
      "find_device_child_by_asset_code",
      { asset_code: assetCode },
      cookie,
      requestId,
    );
    results.push(assetResult);

    const match = extractAssetMatch(assetResult);
    if (match?.device?.de_id) {
      if (wantsDetails) {
        results.push(
          await safeExecuteTool(
            "get_device_details",
            { device_id: match.device.de_id },
            cookie,
            requestId,
          ),
        );
      }

      if (wantsAvailability) {
        results.push(
          await safeExecuteTool(
            "get_device_borrow_summary",
            { device_id: match.device.de_id },
            cookie,
            requestId,
          ),
        );

        if (dateRange) {
          const childId =
            typeof (match.child as { dec_id?: number } | undefined)?.dec_id === "number"
              ? (match.child as { dec_id: number }).dec_id
              : undefined;
          results.push(
            await safeExecuteTool(
              "get_device_available_for_ticket",
              {
                device_id: match.device.de_id,
                device_child_ids: childId ? [childId] : undefined,
                start_date: dateRange.startDate,
                end_date: dateRange.endDate,
              },
              cookie,
              requestId,
            ),
          );
        }
      }
    }

    return results;
  }

  if ((wantsListAllAvailability || wantsListAllDevices) && !deviceId) {
    const listParams: Record<string, unknown> = {
      only_available: wantsAvailability,
    };

    if (searchTerm) {
      listParams.search = searchTerm;
    }

    results.push(
      await safeExecuteTool(
        "list_devices_with_availability",
        listParams,
        cookie,
        requestId,
      ),
    );
    return results;
  }

  if (wantsAvailability) {
    if (deviceId) {
      if (wantsDetails) {
        results.push(
          await safeExecuteTool(
            "get_device_details",
            { device_id: deviceId },
            cookie,
            requestId,
          ),
        );
      }
      results.push(
        await safeExecuteTool(
          "get_device_borrow_summary",
          { device_id: deviceId },
          cookie,
          requestId,
        ),
      );

      if (dateRange) {
        results.push(
          await safeExecuteTool(
            "get_device_available_for_ticket",
            {
                device_id: deviceId,
                start_date: dateRange.startDate,
                end_date: dateRange.endDate,
              },
              cookie,
              requestId,
            ),
          );
        } else {
          const availability = await safeExecuteTool(
            "get_device_children_availability",
            { device_id: deviceId },
            cookie,
            requestId,
          );
          results.push(filterAvailableChildren(availability));
        }

      return results;
    }

    if (searchTerm) {
      const list = await safeExecuteTool(
        "list_devices_with_availability",
        {
          search: searchTerm,
          only_available: dateRange ? false : true,
        },
        cookie,
        requestId,
      );
      results.push(list);

      const matches = getArrayResult<{ de_id?: number }>(list);
      if (matches.length === 1 && typeof matches[0]?.de_id === "number") {
        const resolvedId = matches[0].de_id as number;
        if (wantsDetails) {
          results.push(
            await safeExecuteTool(
              "get_device_details",
              { device_id: resolvedId },
              cookie,
              requestId,
            ),
          );
        }
        results.push(
          await safeExecuteTool(
            "get_device_borrow_summary",
            { device_id: resolvedId },
            cookie,
            requestId,
          ),
        );

        if (dateRange) {
          results.push(
            await safeExecuteTool(
              "get_device_available_for_ticket",
              {
                device_id: resolvedId,
                start_date: dateRange.startDate,
                end_date: dateRange.endDate,
              },
              cookie,
              requestId,
            ),
          );
        } else {
          const availability = await safeExecuteTool(
            "get_device_children_availability",
            { device_id: resolvedId },
            cookie,
            requestId,
          );
          results.push(filterAvailableChildren(availability));
        }
      }

      return results;
    }

    results.push(
      await safeExecuteTool(
        "list_devices_with_availability",
        { only_available: true },
        cookie,
        requestId,
      ),
    );
    return results;
  }

  if (deviceId) {
    results.push(
      await safeExecuteTool(
        "get_device_details",
        { device_id: deviceId },
        cookie,
        requestId,
      ),
    );
    return results;
  }

  if (searchTerm) {
    if (looksLikeStrongDeviceReference(searchTerm)) {
      const fallbackList = await safeExecuteTool(
        "list_devices_with_availability",
        { search: searchTerm, limit: 10 },
        cookie,
        requestId,
      );
      results.push(fallbackList);

      if (wantsDetails) {
        const matches = getArrayResult<{ de_id?: number }>(fallbackList);
        if (matches.length === 1 && typeof matches[0]?.de_id === "number") {
          results.push(
            await safeExecuteTool(
              "get_device_details",
              { device_id: matches[0].de_id },
              cookie,
              requestId,
            ),
          );
        }
      }

      return results;
    }

    const search = await safeExecuteTool(
      "search_devices",
      { search: searchTerm, limit: 10 },
      cookie,
      requestId,
    );
    results.push(search);

    if (wantsDetails) {
      const matches = getArrayResult<{ de_id?: number }>(search);
      if (matches.length === 1 && typeof matches[0]?.de_id === "number") {
        results.push(
          await safeExecuteTool(
            "get_device_details",
            { device_id: matches[0].de_id },
            cookie,
            requestId,
          ),
        );
      }
    }

    return results;
  }

  results.push(
    await safeExecuteTool("search_devices", { limit: 10 }, cookie, requestId),
  );
  return results;
}

function getClarificationResponse(
  intent: ClassifiedIntent,
  query: string,
): string | null {
  if (intent.intent !== "device_lookup") return null;

  const wantsAvailability = isAvailabilityQuery(query);
  const wantsDetails = isDetailQuery(query);
  const deviceId = parseNumericId(intent.entities.deviceId);
  const searchTerm = buildDeviceSearchTerm(query, intent);
  const assetCode = extractAssetCode(query);
  const dateRange = extractDateRange(query);

  if (assetCode) {
    return null;
  }

  if (wantsAvailability && !deviceId && !searchTerm) {
    if (dateRange) {
      return "ถ้าต้องการเช็คอุปกรณ์ว่างตามช่วงวัน กรุณาระบุชื่อรุ่นหรือรหัสอุปกรณ์ก่อนครับ เช่น “MacBook ว่างพรุ่งนี้ไหม”";
    }
    if (isListAllAvailabilityQuery(query)) {
      return null;
    }
    return "ต้องการเช็คอุปกรณ์รุ่นไหนหรือรหัสอะไรครับ? ถ้าต้องการลิสต์อุปกรณ์ว่างทั้งหมด บอกว่า “ลิสต์อุปกรณ์ว่างทั้งหมด” ได้ครับ";
  }

  if (wantsAvailability && hasDateHint(query) && !dateRange) {
    return "ต้องการเช็คช่วงวันไหนครับ? บอกเป็นวันเริ่ม–วันสิ้นสุด (เช่น 2026-03-20 ถึง 2026-03-22) หรือบอกว่า วันนี้/พรุ่งนี้/สัปดาห์หน้า ก็ได้ครับ";
  }

  if (wantsDetails && !deviceId && !searchTerm) {
    return "ต้องการดูรายละเอียดของอุปกรณ์ไหนครับ? ระบุชื่ออุปกรณ์หรือรหัสอุปกรณ์ให้หน่อยครับ";
  }

  return null;
}

function isAvailabilityQuery(query: string): boolean {
  return /(ว่าง|พร้อมใช้|พร้อมยืม|ยืมได้|available|ready|คงเหลือ|เหลือ)/i.test(
    query,
  );
}

function isDetailQuery(query: string): boolean {
  return /(รายละเอียด|detail|spec|สเปค|ซีเรียล|serial|asset|รหัส|code)/i.test(
    query,
  );
}

function parseNumericId(value?: string): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDeviceSearchTerm(
  query: string,
  intent: ClassifiedIntent,
): string | undefined {
  if (intent.entities.deviceName?.trim()) {
    const normalized = normalizeDeviceSearchTerm(intent.entities.deviceName);
    return normalized || undefined;
  }

  const strongReference = extractStrongDeviceReference(query);
  if (strongReference) {
    return strongReference;
  }

  const rawKeywords = intent.entities.keywords ?? [];
  if (rawKeywords.length === 0) return intent.entities.deviceId?.trim();

  const availabilityTerms = new Set([
    "ว่าง",
    "พร้อมใช้",
    "พร้อมยืม",
    "ยืมได้",
    "available",
    "ready",
    "คงเหลือ",
    "เหลือ",
    "ใช้งาน",
    "ใช้งานได้",
  ]);

  const listTerms = new Set([
    "ลิสต์",
    "รายการ",
    "ทั้งหมด",
    "all",
    "list",
    "show",
    "แสดง",
    "รวม",
  ]);

  const genericDeviceTerms = new Set([
    "อุปกรณ์",
    "เครื่อง",
    "device",
    "devices",
    "asset",
    "assets",
    "inventory",
  ]);

  const fillerTerms = new Set([
    "ตรวจสอบ",
    "เช็ค",
    "เช็ก",
    "ดู",
    "ค้นหา",
    "หา",
    "สอบถาม",
    "ถาม",
    "บอก",
    "อยาก",
    "ต้องการ",
    "ขอ",
    "ช่วย",
    "กรุณา",
    "มี",
    "ที่",
    "ให้",
    "ด้วย",
    "อะไร",
    "บ้าง",
    "ไหน",
    "ขณะนี้",
    "วันที่",
    "วัน",
    "เวลา",
  ]);

  const temporalTerms = new Set([
    "วันนี้",
    "พรุ่งนี้",
    "มะรืน",
    "เมื่อวาน",
    "สัปดาห์",
    "อาทิตย์",
    "เดือน",
    "ปี",
    "หน้า",
    "นี้",
    "ช่วง",
    "ระหว่าง",
    "ถึง",
    "จนถึง",
    "from",
    "to",
    "today",
    "tomorrow",
    "next",
    "this",
    "week",
    "month",
    "day",
    "time",
    "date",
  ]);

  const trailingParticles = /(นะครับ|นะคะ|ครับ|ค่ะ|คะ|นะ|ไหม|มั้ย|รึเปล่า|หรือเปล่า|หรือปล่าว|เปล่า|ปะ|มะ)$/i;

  const stripSubstrings = (value: string, substrings: string[]): string => {
    let output = value;
    for (const sub of substrings) {
      if (!sub) continue;
      output = output.split(sub).join("");
    }
    return output;
  };

  const normalizeKeyword = (word: string): string => {
    let normalized = word.trim().toLowerCase();
    if (!normalized) return "";
    normalized = normalized.replace(trailingParticles, "");
    normalized = stripSubstrings(normalized, Array.from(fillerTerms));
    normalized = stripSubstrings(normalized, Array.from(listTerms));
    normalized = stripSubstrings(normalized, Array.from(availabilityTerms));
    normalized = stripSubstrings(normalized, Array.from(genericDeviceTerms));
    normalized = stripSubstrings(normalized, Array.from(temporalTerms));
    normalized = normalized.replace(/\b\d+\b/g, "");
    return normalized.trim();
  };

  const cleaned = rawKeywords
    .map((word) => normalizeKeyword(word))
    .filter((word) => word.length > 0)
    .filter((word) => !availabilityTerms.has(word.toLowerCase()))
    .filter((word) => !listTerms.has(word.toLowerCase()))
    .filter((word) => !genericDeviceTerms.has(word.toLowerCase()))
    .filter((word) => !fillerTerms.has(word.toLowerCase()))
    .filter((word) => !temporalTerms.has(word.toLowerCase()));

  const term = cleaned.join(" ").trim();
  return normalizeDeviceSearchTerm(term) || intent.entities.deviceId?.trim();
}

function normalizeDeviceSearchTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeStrongDeviceReference(value: string): boolean {
  return isStrongDeviceToken(value);
}

function extractStrongDeviceReference(query: string): string | null {
  const assetCode = extractAssetCode(query);
  if (assetCode) return assetCode;

  const stopTokens = new Set([
    "list",
    "show",
    "all",
    "items",
    "devices",
    "device",
    "อุปกรณ์",
    "ทั้งหมด",
    "รายการ",
    "แสดง",
    "รวม",
  ]);

  const candidates = Array.from(
    query.matchAll(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b|\b[A-Za-z0-9]{3,}\b/g),
    (match) => match[0],
  );

  for (const candidate of candidates) {
    if (stopTokens.has(candidate.toLowerCase())) {
      continue;
    }
    if (isStrongDeviceToken(candidate)) {
      return candidate.toUpperCase();
    }
  }

  return null;
}

function isStrongDeviceToken(token: string): boolean {
  const normalized = token.trim();
  if (normalized.length < 3) return false;
  if (/^ASSET-[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(normalized)) return true;
  if (/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(normalized)) return true;
  if (/^(?=.*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(normalized)) return true;
  return false;
}

function extractAssetCode(query: string): string | null {
  const match = query.match(/\bASSET-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i);
  if (match?.[0]) {
    return match[0].toUpperCase();
  }
  return null;
}

function extractAssetMatch(
  call: ToolCall,
): {
  device?: { de_id?: number };
  child?: {
    dec_id?: number;
    dec_asset_code?: string;
    dec_serial_number?: string | null;
    dec_status?: string;
    dec_has_serial_number?: boolean;
  };
  available?: boolean;
} | null {
  if (!call.result || typeof call.result !== "object") return null;
  const result = call.result as {
    matches?: Array<{
      device?: { de_id?: number };
      child?: {
        dec_id?: number;
        dec_asset_code?: string;
        dec_serial_number?: string | null;
        dec_status?: string;
        dec_has_serial_number?: boolean;
      };
      available?: boolean;
    }>;
  };
  if (!Array.isArray(result.matches) || result.matches.length === 0) return null;
  return result.matches[0] ?? null;
}

function isListAllAvailabilityQuery(query: string): boolean {
  return /(ทั้งหมด|ลิสต์|รายการ|all|list|show|แสดง|รวม|มีอุปกรณ์ว่าง|มีของว่าง|มีอะไรว่าง|มีอะไรว่างบ้าง|อุปกรณ์ว่างมีอะไรบ้าง|มีอุปกรณ์ว่างอะไรบ้าง|อุปกรณ์ไหนว่าง|ของว่างอะไรบ้าง|อันไหนว่าง|ไหนว่าง|ตรวจสอบอุปกรณ์.*ว่าง|เช็คอุปกรณ์.*ว่าง|ดูอุปกรณ์.*ว่าง|any available devices|any available equipment)/i.test(
    query,
  );
}

function isListAllDevicesQuery(query: string): boolean {
  return /(รายการอุปกรณ์ทั้งหมด|ลิสต์อุปกรณ์ทั้งหมด|อุปกรณ์ทั้งหมด|รายการอุปกรณ์ในระบบ|อุปกรณ์ในระบบมีอะไรบ้าง|มีอุปกรณ์อะไรบ้างในระบบ|list all devices|show all devices|all devices)/i.test(
    query,
  );
}

function wantsAllNotifications(query: string): boolean {
  return /(ทั้งหมด|all|แสดงทั้งหมด|ทั้งหมดที่มี|ทั้งหมดของฉัน|ทั้งหมดในระบบ)/i.test(
    query,
  );
}

function wantsUnreadNotifications(query: string): boolean {
  return /(ยังไม่อ่าน|ยังไม่ได้อ่าน|ค้างอ่าน|unread)/i.test(query);
}

function buildDeterministicListResponse(
  query: string,
  toolResults: ToolCall[],
): string | null {
  if (!isListAllAvailabilityQuery(query) && !isListAllDevicesQuery(query)) return null;

  const listTool = toolResults.find(
    (tool) => tool.tool === "list_devices_with_availability",
  );

  if (!listTool) {
    return null;
  }

  if (listTool.error) {
    return "ไม่สามารถดึงรายการอุปกรณ์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }

  if (!Array.isArray(listTool.result)) {
    return null;
  }

  const devices = listTool.result as Array<Record<string, unknown>>;
  if (devices.length === 0) {
    return isAvailabilityQuery(query)
      ? "ไม่พบอุปกรณ์ว่างในขณะนี้"
      : "ไม่พบอุปกรณ์";
  }

  const header = isAvailabilityQuery(query)
    ? `รายการอุปกรณ์ว่างทั้งหมด (${devices.length} รายการ):`
    : `รายการอุปกรณ์ทั้งหมด (${devices.length} รายการ):`;

  const lines = devices.map((device, index) => {
    const name = (device.de_name || device.name || "Unknown") as string;
    const id = (device.de_id || device.id || "") as number | string;
    const available = (device.available ?? "?") as number | string;
    const total = (device.total ?? "?") as number | string;
    const location = (device.de_location || device.location || "N/A") as string;
    const idLabel = id ? ` (ID: ${id})` : "";
    return `${index + 1}. ${name}${idLabel} - ว่าง ${available}/${total} - ที่เก็บ: ${location}`;
  });

  return [header, ...lines].join("\n");
}

function buildDeterministicNotificationResponse(
  intent: string,
  query: string,
  toolResults: ToolCall[],
): string | null {
  if (intent !== "notification_check") return null;

  const notificationTool = toolResults.find(
    (tool) => tool.tool === "get_notifications",
  );

  if (!notificationTool) return null;

  if (notificationTool.error) {
    return "ไม่สามารถดึงการแจ้งเตือนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }

  const notifications = extractNotifications(notificationTool.result);
  if (notifications.length === 0) {
    return "ไม่มีการแจ้งเตือนในขณะนี้";
  }

  const unreadOnly = wantsUnreadNotifications(query);
  const { ordered, unreadCount } = orderNotifications(notifications);
  const total = ordered.length;

  const header = unreadOnly
    ? `การแจ้งเตือนที่ยังไม่ได้อ่าน (${unreadCount} รายการ):`
    : wantsAllNotifications(query)
      ? `การแจ้งเตือนทั้งหมด (${total} รายการ):`
      : `การแจ้งเตือนล่าสุด (${total} รายการ)${
          unreadCount > 0 ? ` — ยังไม่ได้อ่าน ${unreadCount} รายการ` : ""
        }:`;

  const lines: string[] = [header];

  const list = unreadOnly ? ordered.filter((n) => isUnreadNotification(n)) : ordered;

  list.forEach((raw, index) => {
    const record = raw as Record<string, unknown>;
    const title =
      (record.n_title as string) ||
      (record.title as string) ||
      "การแจ้งเตือน";
    const messageRaw =
      (record.n_message as string) || (record.message as string) || "";
    const message = formatNotificationMessage(messageRaw);
    const createdAt =
      (record.send_at as string) ||
      (record.created_at as string) ||
      "";
    const route = normalizeNotificationRoute(
      (record.n_target_route as string) ||
        (record.target_route as string) ||
        (record.link as string) ||
        null,
    );

    const timeLabel = createdAt ? ` (${createdAt})` : "";
    lines.push(`${index + 1}. ${title}${timeLabel}`);
    if (message) {
      lines.push(`รายละเอียด: ${message}`);
    }
    if (route) {
      lines.push(`ดูเพิ่มเติม: [เปิดรายละเอียด](${route})`);
    }
  });

  return lines.join("\n");
}

function extractNotifications(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }
  if (result && typeof result === "object") {
    const payload = result as Record<string, unknown>;
    if (Array.isArray(payload.notifications)) {
      return payload.notifications as Array<Record<string, unknown>>;
    }
    if (Array.isArray(payload.data)) {
      return payload.data as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function isUnreadNotification(notification: Record<string, unknown>): boolean {
  if ("nr_status" in notification) return notification.nr_status === "UNREAD";
  if ("status" in notification) return notification.status === "UNREAD";
  if ("read_at" in notification) return !notification.read_at;
  if ("isRead" in notification) return !notification.isRead;
  return false;
}

function orderNotifications(notifications: Array<Record<string, unknown>>): {
  ordered: Array<Record<string, unknown>>;
  unreadCount: number;
} {
  const unread = notifications.filter((n) => isUnreadNotification(n));
  const read = notifications.filter((n) => !isUnreadNotification(n));
  return { ordered: [...unread, ...read], unreadCount: unread.length };
}

function formatNotificationMessage(message: string): string {
  if (!message) return "";
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^ดูเพิ่มเติม$/i.test(line))
    .filter((line) => !/^ดูเพิ่ม$/i.test(line));
  return lines.join(" | ");
}

function normalizeNotificationRoute(route: string | null): string | null {
  if (!route) return null;
  const trimmed = route.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

function buildDeterministicAssetResponse(
  intent: string,
  query: string,
  toolResults: ToolCall[],
): string | null {
  if (intent !== "device_lookup") return null;

  const assetCode = extractAssetCode(query);
  if (!assetCode) return null;

  const assetTool = toolResults.find(
    (tool) => tool.tool === "find_device_child_by_asset_code",
  );
  if (!assetTool) return null;

  if (assetTool.error) {
    return `ไม่สามารถตรวจสอบอุปกรณ์ ${assetCode} ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง`;
  }

  const match = extractAssetMatch(assetTool);
  if (!match?.child) {
    return `ไม่พบอุปกรณ์ที่มี Asset Code ${assetCode}`;
  }

  const child = match.child as Record<string, unknown>;
  const device = (match.device ?? {}) as Record<string, unknown>;
  const decStatus = (child.dec_status as string | undefined) ?? undefined;
  const derivedAvailable = deriveAvailabilityFromChild(child, match.available);
  const dateRange = extractDateRange(query);

  const statusLabel = mapChildStatus(decStatus);
  const availabilityLabel = derivedAvailable ? "พร้อมใช้งาน" : "ไม่พร้อมใช้งาน";
  const availabilityYesNo = derivedAvailable ? "ใช่" : "ไม่ใช่";
  const assetLabel =
    (child.dec_asset_code as string | undefined) ?? assetCode;

  if (dateRange) {
    const dateTool = toolResults.find(
      (tool) => tool.tool === "get_device_available_for_ticket",
    );
    if (dateTool?.error) {
      return `ไม่สามารถตรวจสอบอุปกรณ์ ${assetLabel} ตามช่วงวันที่ที่ระบุได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง`;
    }

    const availableChildren = dateTool ? getArrayResult<{ dec_id?: number }>(dateTool) : [];
    const childId = child.dec_id as number | undefined;
    const isAvailableForRange =
      typeof childId === "number"
        ? availableChildren.some((candidate) => candidate.dec_id === childId)
        : availableChildren.length > 0;
    const dateRangeLabel = `${dateRange.startDate} ถึง ${dateRange.endDate}`;

    return [
      `ผลการตรวจสอบ ${assetLabel} สำหรับช่วง ${dateRangeLabel}:`,
      `สถานะตามช่วงวันที่: ${isAvailableForRange ? "พร้อมใช้งาน" : "ไม่พร้อมใช้งาน"}`,
      device.de_name || device.name
        ? `อุปกรณ์แม่: ${device.de_name || device.name}${
            device.de_id ? ` (ID: ${device.de_id})` : ""
          }`
        : null,
      device.de_location || device.location
        ? `ที่เก็บ: ${device.de_location || device.location}`
        : null,
      child.dec_serial_number ? `Serial: ${child.dec_serial_number}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  const lines: string[] = [];
  lines.push(`ผลการตรวจสอบ ${assetLabel}:`);
  if (device.de_name || device.name) {
    lines.push(
      `อุปกรณ์แม่: ${device.de_name || device.name}${
        device.de_id ? ` (ID: ${device.de_id})` : ""
      }`,
    );
  }
  if (device.de_location || device.location) {
    lines.push(`ที่เก็บ: ${device.de_location || device.location}`);
  }
  if (child.dec_serial_number) {
    lines.push(`Serial: ${child.dec_serial_number}`);
  }
  lines.push(`สถานะ: ${availabilityLabel} (${statusLabel}${decStatus ? ` / ${decStatus}` : ""})`);
  lines.push(`พร้อมให้ยืมตอนนี้: ${availabilityYesNo}`);

  const borrowRange = formatBorrowRange(
    (child.activeBorrow as Array<Record<string, unknown>>) ?? [],
  );
  if (borrowRange) {
    lines.push(`ช่วงการยืม: ${borrowRange}`);
  }

  return lines.join("\n");
}

function buildDeterministicAvailabilityResponse(
  intent: string,
  query: string,
  toolResults: ToolCall[],
): string | null {
  if (intent !== "device_lookup" || !isAvailabilityQuery(query)) return null;

  const dateRange = extractDateRange(query);
  const summaryTool = toolResults.find(
    (tool) => tool.tool === "get_device_borrow_summary",
  );
  const ticketTool = toolResults.find(
    (tool) => tool.tool === "get_device_available_for_ticket",
  );
  const childTool = toolResults.find(
    (tool) => tool.tool === "get_device_children_availability",
  );
  const listTool = toolResults.find(
    (tool) => tool.tool === "list_devices_with_availability",
  );

  if (!summaryTool && !ticketTool && !childTool && !listTool) return null;

  if (summaryTool?.error) {
    return "ไม่สามารถดึงข้อมูลอุปกรณ์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }
  if (ticketTool?.error) {
    return "ไม่สามารถตรวจสอบอุปกรณ์ตามช่วงวันที่ที่ระบุได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }
  if (childTool?.error) {
    return "ไม่สามารถตรวจสอบสถานะอุปกรณ์ลูกได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }
  if (listTool?.error) {
    return "ไม่สามารถดึงรายการอุปกรณ์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
  }

  const lines: string[] = [];
  const summary = extractBorrowSummary(summaryTool?.result);

  if (summary) {
    lines.push(`ผลการตรวจสอบอุปกรณ์ ${summary.name}:`);
    if (summary.serial) lines.push(`Serial: ${summary.serial}`);
    if (summary.location) lines.push(`ที่เก็บ: ${summary.location}`);
    lines.push(`พร้อมใช้งาน: ${summary.ready}/${summary.total}`);
  }

  if (dateRange) {
    lines.push(`ช่วงวันที่: ${dateRange.startDate} ถึง ${dateRange.endDate}`);
  }

  const children = extractAvailabilityChildren(
    ticketTool?.result ?? childTool?.result,
  );
  if (children.length > 0) {
    lines.push("อุปกรณ์ลูกที่ว่าง:");
    children.forEach((child, index) => {
      const label =
        (child.dec_asset_code as string | undefined) ||
        (child.dec_serial_number as string | undefined) ||
        `item-${index + 1}`;
      const status = (child.dec_status as string | undefined) || "N/A";
      lines.push(
        `${index + 1}. ${label}${child.dec_serial_number ? ` / ${child.dec_serial_number}` : ""} - ${mapChildStatus(status)} (${status})`,
      );
    });
    return lines.join("\n");
  }

  const list = Array.isArray(listTool?.result)
    ? (listTool?.result as Array<Record<string, unknown>>)
    : [];

  if (
    dateRange &&
    list.length > 1 &&
    !isListAllAvailabilityQuery(query) &&
    !isListAllDevicesQuery(query)
  ) {
    return "พบหลายอุปกรณ์ที่ตรงกับคำค้นนี้ กรุณาระบุชื่อรุ่นหรือรหัสอุปกรณ์ให้ชัดเจนกว่านี้ก่อน เพื่อให้ตรวจสอบตามช่วงวันที่ได้ถูกต้อง";
  }

  if (list.length > 0) {
    lines.push(`รายการอุปกรณ์ว่าง (${list.length} รายการ):`);
    list.forEach((device, index) => {
      const name = (device.de_name || device.name || "Unknown") as string;
      const id = (device.de_id || device.id || "") as number | string;
      const available = (device.available ?? "?") as number | string;
      const total = (device.total ?? "?") as number | string;
      const location = (device.de_location || device.location || "N/A") as string;
      lines.push(
        `${index + 1}. ${name}${id ? ` (ID: ${id})` : ""} - ว่าง ${available}/${total} - ที่เก็บ: ${location}`,
      );
    });
    return lines.join("\n");
  }

  if (summary) {
    lines.push("ไม่พบอุปกรณ์ว่างในช่วงเวลาที่ระบุ");
    return lines.join("\n");
  }

  return null;
}

function extractBorrowSummary(result: unknown): {
  name: string;
  serial?: string;
  location?: string;
  ready: number;
  total: number;
} | null {
  if (!result || typeof result !== "object") return null;
  const payload = result as Record<string, unknown>;
  const name =
    (payload.de_name as string | undefined) ||
    (payload.name as string | undefined);
  if (!name) return null;
  return {
    name,
    serial:
      (payload.de_serial_number as string | undefined) ||
      (payload.serial as string | undefined),
    location:
      (payload.de_location as string | undefined) ||
      (payload.location as string | undefined),
    ready:
      typeof payload.ready === "number"
        ? payload.ready
        : typeof payload.available === "number"
          ? payload.available
          : 0,
    total: typeof payload.total === "number" ? payload.total : 0,
  };
}

function extractAvailabilityChildren(
  result: unknown,
): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }
  if (result && typeof result === "object") {
    const payload = result as Record<string, unknown>;
    if (Array.isArray(payload.data)) {
      return payload.data as Array<Record<string, unknown>>;
    }
    if (Array.isArray(payload.children)) {
      return payload.children as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function mapChildStatus(status?: string): string {
  switch ((status || "").toUpperCase()) {
    case "READY":
      return "พร้อมใช้งาน";
    case "BORROWED":
      return "กำลังยืม";
    case "REPAIRING":
      return "กำลังซ่อม";
    case "DAMAGED":
      return "เสียหาย";
    case "LOST":
      return "สูญหาย";
    case "UNAVAILABLE":
      return "ไม่พร้อมใช้งาน";
    default:
      return "ไม่ทราบสถานะ";
  }
}

function deriveAvailabilityFromChild(
  child: Record<string, unknown>,
  fallback?: boolean,
): boolean {
  if (typeof fallback === "boolean") return fallback;
  const status = (child.dec_status as string | undefined)?.toUpperCase();
  const activeBorrow = Array.isArray(child.activeBorrow)
    ? child.activeBorrow
    : [];
  const isReady = status === "READY";
  const hasActiveBorrow = activeBorrow.length > 0;
  return isReady && !hasActiveBorrow;
}

function formatBorrowRange(
  activeBorrow: Array<Record<string, unknown>>,
): string | null {
  if (!activeBorrow || activeBorrow.length === 0) return null;
  const formatDate = (value: unknown): string => {
    if (!value) return "";
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return value;
    }
    return String(value);
  };

  const first = activeBorrow[0] ?? {};
  const start = formatDate(first.da_start);
  const end = formatDate(first.da_end);
  const range = start || end ? `${start || "?"} ถึง ${end || "?"}` : "";

  if (activeBorrow.length === 1) {
    return range || null;
  }

  const suffix = ` (อีก ${activeBorrow.length - 1} รายการ)`;
  return range ? `${range}${suffix}` : suffix;
}

function extractDateRange(
  query: string,
): { startDate: string; endDate: string } | null {
  const isoMatches = Array.from(
    query.matchAll(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/g),
  );
  if (isoMatches.length === 1) {
    const date = normalizeIsoDate(isoMatches[0][1], isoMatches[0][2], isoMatches[0][3]);
    return { startDate: date, endDate: date };
  }
  if (isoMatches.length >= 2) {
    const start = normalizeIsoDate(isoMatches[0][1], isoMatches[0][2], isoMatches[0][3]);
    const end = normalizeIsoDate(isoMatches[1][1], isoMatches[1][2], isoMatches[1][3]);
    return orderDateRange(start, end);
  }

  const dmyMatches = Array.from(
    query.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g),
  );
  if (dmyMatches.length === 1) {
    const date = normalizeIsoDate(dmyMatches[0][3], dmyMatches[0][2], dmyMatches[0][1]);
    return { startDate: date, endDate: date };
  }
  if (dmyMatches.length >= 2) {
    const start = normalizeIsoDate(dmyMatches[0][3], dmyMatches[0][2], dmyMatches[0][1]);
    const end = normalizeIsoDate(dmyMatches[1][3], dmyMatches[1][2], dmyMatches[1][1]);
    return orderDateRange(start, end);
  }

  return extractRelativeDateRange(query);
}

function normalizeIsoDate(year: string, month: string, day: string): string {
  const mm = month.padStart(2, "0");
  const dd = day.padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function extractRelativeDateRange(
  query: string,
): { startDate: string; endDate: string } | null {
  const lower = query.toLowerCase();
  const today = startOfDay(new Date());

  const hasToday = /(วันนี้|today)/i.test(lower);
  const hasTomorrow = /(พรุ่งนี้|tomorrow)/i.test(lower);
  const hasDayAfter = /(มะรืน|day after tomorrow)/i.test(lower);
  const hasYesterday = /(เมื่อวาน|yesterday)/i.test(lower);

  if (hasToday && hasTomorrow) {
    return orderDateRange(formatLocalDate(today), formatLocalDate(addDays(today, 1)));
  }

  if (hasTomorrow && hasDayAfter) {
    return orderDateRange(formatLocalDate(addDays(today, 1)), formatLocalDate(addDays(today, 2)));
  }

  if (hasToday) {
    const date = formatLocalDate(today);
    return { startDate: date, endDate: date };
  }

  if (hasTomorrow) {
    const date = formatLocalDate(addDays(today, 1));
    return { startDate: date, endDate: date };
  }

  if (hasDayAfter) {
    const date = formatLocalDate(addDays(today, 2));
    return { startDate: date, endDate: date };
  }

  if (hasYesterday) {
    const date = formatLocalDate(addDays(today, -1));
    return { startDate: date, endDate: date };
  }

  if (/(สัปดาห์หน้า|อาทิตย์หน้า|next week)/i.test(lower)) {
    const nextWeekStart = addDays(startOfWeek(today), 7);
    const nextWeekEnd = addDays(nextWeekStart, 6);
    return { startDate: formatLocalDate(nextWeekStart), endDate: formatLocalDate(nextWeekEnd) };
  }

  if (/(สัปดาห์นี้|อาทิตย์นี้|this week)/i.test(lower)) {
    const weekEnd = endOfWeek(today);
    return { startDate: formatLocalDate(today), endDate: formatLocalDate(weekEnd) };
  }

  if (/(เดือนหน้า|next month)/i.test(lower)) {
    const firstNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lastNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return { startDate: formatLocalDate(firstNextMonth), endDate: formatLocalDate(lastNextMonth) };
  }

  return null;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  return addDays(start, 6);
}

function hasDateHint(query: string): boolean {
  return (
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/.test(query) ||
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/.test(query) ||
    /(วันนี้|พรุ่งนี้|มะรืน|เมื่อวาน|สัปดาห์หน้า|อาทิตย์หน้า|สัปดาห์นี้|อาทิตย์นี้|เดือนหน้า|today|tomorrow|next week|this week|next month|ช่วง|ระหว่าง|ถึง|จนถึง|from|to)/i.test(
      query,
    )
  );
}

function orderDateRange(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start > end) {
    return { startDate: endDate, endDate: startDate };
  }
  return { startDate, endDate };
}

function getArrayResult<T>(call: ToolCall): T[] {
  return Array.isArray(call.result) ? (call.result as T[]) : [];
}

function filterAvailableChildren(call: ToolCall): ToolCall {
  const result = getArrayResult<{
    dec_status?: string;
    activeBorrow?: Array<unknown>;
  }>(call);

  if (result.length === 0) return call;

  const filtered = result.filter((item) => {
    const isReady = item.dec_status === "READY";
    const hasActiveBorrow = Array.isArray(item.activeBorrow) && item.activeBorrow.length > 0;
    return isReady && !hasActiveBorrow;
  });

  return { ...call, result: filtered };
}

async function safeExecuteTool(
  tool: string,
  params: Record<string, unknown>,
  cookie?: string,
  requestId?: string,
): Promise<ToolCall> {
  const startedAt = Date.now();
  try {
    const result = await executeTool(tool, params, cookie);
    const durationMs = Date.now() - startedAt;
    recordToolTelemetry(tool, "success", durationMs, requestId);
    return { tool, params, result };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordToolTelemetry(tool, "error", durationMs, requestId);
    console.error("[AI Orchestrator] Tool execution failed:", {
      tool,
      requestId,
      durationMs,
      error: error instanceof Error ? error.message : error,
    });
    return {
      tool,
      params,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

function recordToolTelemetry(
  tool: string,
  status: "success" | "error",
  durationMs: number,
  requestId?: string,
): void {
  const labels = { tool, status };
  metrics.counter("tool_requests_total", labels);
  metrics.histogram("tool_request_duration_ms", durationMs, labels);
  logger.info("[AI Orchestrator] tool telemetry", {
    requestId,
    tool,
    status,
    durationMs,
  });
}

function createEmptyTimings(): PipelineTimings {
  return {
    safetyMs: 0,
    intentMs: 0,
    ragMs: 0,
    toolMs: 0,
    responseMs: 0,
    totalMs: 0,
  };
}

function finalizeOrchestratorResult(params: {
  requestId: string;
  query: string;
  intent: string;
  response: string;
  responsePath: ResponsePath;
  timings: PipelineTimings;
  sources: { rag?: RAGContext[]; tools?: ToolCall[] };
  safetyResult?: SafetyCheckResult;
  ragTelemetry?: RAGRetrievalTelemetry;
}): OrchestratorResult {
  const totalMs = params.timings.totalMs > 0 ? params.timings.totalMs : 0;
  params.timings.totalMs = totalMs;
  const status = params.responsePath === "blocked" ? "blocked" : "success";
  const labels = {
    intent: params.intent,
    path: params.responsePath,
    status,
  };

  metrics.counter(METRIC_NAMES.AI_REQUESTS_TOTAL, labels);
  metrics.histogram(METRIC_NAMES.AI_REQUEST_DURATION, totalMs, labels);
  metrics.counter("chat_response_path_total", {
    intent: params.intent,
    path: params.responsePath,
  });
  metrics.histogram("chat_stage_duration_ms", params.timings.safetyMs, {
    stage: "safety",
    intent: params.intent,
    path: params.responsePath,
  });
  metrics.histogram("chat_stage_duration_ms", params.timings.intentMs, {
    stage: "intent",
    intent: params.intent,
    path: params.responsePath,
  });
  metrics.histogram("chat_stage_duration_ms", params.timings.ragMs, {
    stage: "rag",
    intent: params.intent,
    path: params.responsePath,
  });
  metrics.histogram("chat_stage_duration_ms", params.timings.toolMs, {
    stage: "tools",
    intent: params.intent,
    path: params.responsePath,
  });
  metrics.histogram("chat_stage_duration_ms", params.timings.responseMs, {
    stage: "response",
    intent: params.intent,
    path: params.responsePath,
  });

  if (params.responsePath !== "blocked") {
    logAIResponse(params.query, params.intent, params.response.length, {
      requestId: params.requestId,
      latencyMs: totalMs,
    });
  }

  logger.info("[AI Orchestrator] pipeline complete", {
    requestId: params.requestId,
    intent: params.intent,
    responsePath: params.responsePath,
    totalMs,
    timings: params.timings,
    ragCount: params.sources.rag?.length ?? 0,
    toolCount: params.sources.tools?.length ?? 0,
    topSimilarity: params.ragTelemetry?.topSimilarity,
    averageSimilarity: params.ragTelemetry?.averageSimilarity,
    zeroHit: params.ragTelemetry?.zeroHit,
  });

  return {
    response: params.response,
    intent: params.intent,
    requestId: params.requestId,
    responsePath: params.responsePath,
    timings: params.timings,
    sources: params.sources,
    safetyResult: params.safetyResult,
    telemetry: params.ragTelemetry
      ? {
          rag: params.ragTelemetry,
          toolCount: params.sources.tools?.length ?? 0,
          toolErrors:
            params.sources.tools?.filter((tool) => Boolean(tool.error)).length ?? 0,
        }
      : {
          toolCount: params.sources.tools?.length ?? 0,
          toolErrors:
            params.sources.tools?.filter((tool) => Boolean(tool.error)).length ?? 0,
        },
  };
}

/**
 * Simple orchestration for streaming responses
 * Returns intermediate results for streaming UI updates
 */
export async function* orchestrateStreaming(
  options: OrchestratorOptions,
): AsyncGenerator<{
  type: "intent" | "rag" | "tools" | "response";
  data: unknown;
}> {
  const {
    query,
    cookie,
    conversationHistory,
    useHybridSearch = true,
  } = options;

  // Step 1: Intent
  const intent = await classifyIntent(query);
  yield { type: "intent", data: intent };

  const clarification = getClarificationResponse(intent, query);
  if (clarification) {
    yield { type: "response", data: clarification };
    return;
  }

  // Step 2: RAG (if applicable)
  if (shouldUseRAG(intent.intent)) {
    const contexts = await retrieveContext(query, useHybridSearch);
    yield { type: "rag", data: contexts };
  }

  // Step 3: Tools (if applicable)
  if (shouldUseTools(intent.intent)) {
    const tools = await executeToolsForIntent(intent, query, cookie);
    yield { type: "tools", data: tools };

    const deterministicResponse = buildDeterministicListResponse(query, tools);
    if (deterministicResponse) {
      yield { type: "response", data: deterministicResponse };
      return;
    }

    const notificationResponse = buildDeterministicNotificationResponse(
      intent.intent,
      query,
      tools,
    );
    if (notificationResponse) {
      yield { type: "response", data: notificationResponse };
      return;
    }

    const assetResponse = buildDeterministicAssetResponse(
      intent.intent,
      query,
      tools,
    );
    if (assetResponse) {
      yield { type: "response", data: assetResponse };
      return;
    }
  }

  // Step 4: Response
  const response = await generateResponse({
    query,
    intent: intent.intent,
    conversationHistory,
  });

  yield { type: "response", data: response };
}
