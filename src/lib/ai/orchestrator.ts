/**
 * AI Orchestrator using LangGraph pattern
 * Coordinates intent classification, RAG retrieval, tool calling, and response generation
 * Includes content safety guardrails
 */

import { classifyIntent } from "./intent-classifier";
import { retrieveRAGContext, retrieveHybridContext } from "./rag-retriever";
import { executeTool, executeToolCalls } from "./tools";
import { generateResponse } from "./response-generator";
import { runSafetyChecks, getBlockedResponse } from "@/lib/safety/guardrails";
import { env } from "@/lib/config";
import type { ClassifiedIntent, RAGContext, ToolCall } from "./types";
import type { SafetyCheckResult } from "@/lib/safety/guardrails";

interface OrchestratorOptions {
  query: string;
  cookie?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  useHybridSearch?: boolean;
  skipSafetyCheck?: boolean;
}

interface OrchestratorResult {
  response: string;
  intent: string;
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
    conversationHistory,
    useHybridSearch = true,
    skipSafetyCheck = false,
  } = options;

  // Step 0: Content Safety Check
  if (!skipSafetyCheck) {
    console.log("[AI Orchestrator] Step 0: Running content safety checks...");
    const safetyResult = runSafetyChecks(query);

    if (!safetyResult.isSafe) {
      console.warn(`[AI Orchestrator] Content blocked: ${safetyResult.violation}`);
      return {
        response: getBlockedResponse(safetyResult.violation || "unknown"),
        intent: "blocked",
        sources: {},
        safetyResult,
      };
    }

    console.log("[AI Orchestrator] Content safety checks passed");
  }

  // Step 1: Classify Intent
  console.log("[AI Orchestrator] Step 1: Classifying intent...");
  const intent = await classifyIntent(query);
  console.log(
    `[AI Orchestrator] Intent: ${intent.intent} (confidence: ${intent.confidence})`,
  );

  const clarification = getClarificationResponse(intent, query);
  if (clarification) {
    return {
      response: clarification,
      intent: "clarification",
      sources: {},
    };
  }

  // Step 2: Parallel execution based on intent
  const [ragContexts, toolResults] = await Promise.all([
    // RAG Retrieval (for general questions)
    shouldUseRAG(intent.intent)
      ? retrieveContext(query, useHybridSearch)
      : Promise.resolve([]),

    // Tool Execution (for specific intents)
    shouldUseTools(intent.intent)
      ? executeToolsForIntent(intent, query, cookie)
      : Promise.resolve([]),
  ]);

  console.log(`[AI Orchestrator] Retrieved ${ragContexts.length} RAG contexts`);
  console.log(`[AI Orchestrator] Executed ${toolResults.length} tool calls`);

  const deterministicResponse = buildDeterministicListResponse(query, toolResults);
  if (deterministicResponse) {
    return {
      response: deterministicResponse,
      intent: intent.intent,
      sources: {
        rag: ragContexts.length > 0 ? ragContexts : undefined,
        tools: toolResults.length > 0 ? toolResults : undefined,
      },
    };
  }

  // Step 3: Generate Response
  console.log("[AI Orchestrator] Step 3: Generating response...");
  const response = await generateResponse({
    query,
    intent: intent.intent,
    ragContexts: ragContexts.length > 0 ? ragContexts : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    conversationHistory,
  });

  return {
    response,
    intent: intent.intent,
    sources: {
      rag: ragContexts.length > 0 ? ragContexts : undefined,
      tools: toolResults.length > 0 ? toolResults : undefined,
    },
  };
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
    if (useHybrid) {
      return await retrieveHybridContext(query, {
        topK: 5,
        minSimilarity: 0.6,
      });
    } else {
      return await retrieveRAGContext(query, { topK: 5, minSimilarity: 0.7 });
    }
  } catch (error) {
    console.error("[AI Orchestrator] RAG retrieval failed:", error);
    return [];
  }
}

/**
 * Execute tools based on intent and entities
 */
async function executeToolsForIntent(
  intent: ClassifiedIntent,
  query: string,
  cookie?: string,
): Promise<ToolCall[]> {
  if (intent.intent === "device_lookup") {
    return executeDeviceLookupTools(intent, query, cookie);
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
      );
    }

    case "notification_check": {
      return await executeToolCalls(
        [{ tool: "get_notifications", params: { unread: true, limit: 20 } }],
        cookie,
      );
    }
  }

  return [];
}

async function executeDeviceLookupTools(
  intent: ClassifiedIntent,
  query: string,
  cookie?: string,
): Promise<ToolCall[]> {
  const results: ToolCall[] = [];
  const wantsAvailability = isAvailabilityQuery(query);
  const wantsDetails = isDetailQuery(query);
  const wantsListAll = isListAllAvailabilityQuery(query);
  const deviceId = parseNumericId(intent.entities.deviceId);
  const searchTerm = buildDeviceSearchTerm(intent);
  const assetCode = extractAssetCode(query);
  const dateRange = wantsAvailability ? extractDateRange(query) : null;

  if (assetCode) {
    const assetResult = await safeExecuteTool(
      "find_device_child_by_asset_code",
      { asset_code: assetCode },
      cookie,
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
          ),
        );
      }

      if (wantsAvailability) {
        results.push(
          await safeExecuteTool(
            "get_device_borrow_summary",
            { device_id: match.device.de_id },
            cookie,
          ),
        );

        if (dateRange) {
          results.push(
            await safeExecuteTool(
              "get_device_available_for_ticket",
              {
                device_id: match.device.de_id,
                start_date: dateRange.startDate,
                end_date: dateRange.endDate,
              },
              cookie,
            ),
          );
        }
      }
    }

    return results;
  }

  if (wantsListAll && !deviceId) {
    const listParams: Record<string, unknown> = {
      only_available: wantsAvailability,
    };

    if (searchTerm) {
      listParams.search = searchTerm;
    }

    results.push(
      await safeExecuteTool("list_devices_with_availability", listParams, cookie),
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
          ),
        );
      }
      results.push(await safeExecuteTool("get_device_borrow_summary", { device_id: deviceId }, cookie));

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
          ),
        );
      } else {
        const availability = await safeExecuteTool(
          "get_device_children_availability",
          { device_id: deviceId },
          cookie,
        );
        results.push(filterAvailableChildren(availability));
      }

      return results;
    }

    if (searchTerm) {
      const list = await safeExecuteTool(
        "list_devices_with_availability",
        { search: searchTerm, only_available: true },
        cookie,
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
            ),
          );
        }
        results.push(
          await safeExecuteTool(
            "get_device_borrow_summary",
            { device_id: resolvedId },
            cookie,
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
            ),
          );
        } else {
          const availability = await safeExecuteTool(
            "get_device_children_availability",
            { device_id: resolvedId },
            cookie,
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
      ),
    );
    return results;
  }

  if (deviceId) {
    results.push(await safeExecuteTool("get_device_details", { device_id: deviceId }, cookie));
    return results;
  }

  if (searchTerm) {
    const search = await safeExecuteTool(
      "search_devices",
      { search: searchTerm, limit: 10 },
      cookie,
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
          ),
        );
      }
    }

    return results;
  }

  results.push(await safeExecuteTool("search_devices", { limit: 10 }, cookie));
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
  const searchTerm = buildDeviceSearchTerm(intent);
  const assetCode = extractAssetCode(query);
  const dateRange = extractDateRange(query);

  if (assetCode) {
    return null;
  }

  if (wantsAvailability && !deviceId && !searchTerm) {
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

function buildDeviceSearchTerm(intent: ClassifiedIntent): string | undefined {
  if (intent.entities.deviceName?.trim()) {
    return intent.entities.deviceName.trim();
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

  const cleaned = rawKeywords
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .filter((word) => !availabilityTerms.has(word.toLowerCase()))
    .filter((word) => !listTerms.has(word.toLowerCase()))
    .filter((word) => !genericDeviceTerms.has(word.toLowerCase()));

  const term = cleaned.join(" ").trim();
  return term || intent.entities.deviceId?.trim();
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
): { device?: { de_id?: number }; child?: { dec_asset_code?: string }; available?: boolean } | null {
  if (!call.result || typeof call.result !== "object") return null;
  const result = call.result as {
    matches?: Array<{
      device?: { de_id?: number };
      child?: { dec_asset_code?: string };
      available?: boolean;
    }>;
  };
  if (!Array.isArray(result.matches) || result.matches.length === 0) return null;
  return result.matches[0] ?? null;
}

function isListAllAvailabilityQuery(query: string): boolean {
  return /(ทั้งหมด|ลิสต์|รายการ|all|list|show|แสดง|รวม)/i.test(query);
}

function buildDeterministicListResponse(
  query: string,
  toolResults: ToolCall[],
): string | null {
  if (!isListAllAvailabilityQuery(query)) return null;

  const listTool = toolResults.find(
    (tool) => tool.tool === "list_devices_with_availability",
  );

  if (!listTool || !Array.isArray(listTool.result)) {
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

function extractDateRange(
  query: string,
): { startDate: string; endDate: string } | null {
  const isoMatches = Array.from(
    query.matchAll(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/g),
  );
  if (isoMatches.length >= 2) {
    const start = normalizeIsoDate(isoMatches[0][1], isoMatches[0][2], isoMatches[0][3]);
    const end = normalizeIsoDate(isoMatches[1][1], isoMatches[1][2], isoMatches[1][3]);
    return orderDateRange(start, end);
  }

  const dmyMatches = Array.from(
    query.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g),
  );
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
): Promise<ToolCall> {
  try {
    const result = await executeTool(tool, params, cookie);
    return { tool, params, result };
  } catch (error) {
    console.error("[AI Orchestrator] Tool execution failed:", error);
    return {
      tool,
      params,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
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
  }

  // Step 4: Response
  const response = await generateResponse({
    query,
    intent: intent.intent,
    conversationHistory,
  });

  yield { type: "response", data: response };
}
