/**
 * AI Orchestrator using LangGraph pattern
 * Coordinates intent classification, RAG retrieval, tool calling, and response generation
 */

import { classifyIntent } from "./intent-classifier";
import { retrieveRAGContext, retrieveHybridContext } from "./rag-retriever";
import { executeToolCalls } from "./tools";
import { generateResponse } from "./response-generator";
import type { ClassifiedIntent, RAGContext, ToolCall } from "./types";

interface OrchestratorOptions {
  query: string;
  cookie?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  useHybridSearch?: boolean;
}

interface OrchestratorResult {
  response: string;
  intent: string;
  sources: {
    rag?: RAGContext[];
    tools?: ToolCall[];
  };
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
  } = options;

  // Step 1: Classify Intent
  console.log("[AI Orchestrator] Step 1: Classifying intent...");
  const intent = await classifyIntent(query);
  console.log(
    `[AI Orchestrator] Intent: ${intent.intent} (confidence: ${intent.confidence})`,
  );

  // Step 2: Parallel execution based on intent
  const [ragContexts, toolResults] = await Promise.all([
    // RAG Retrieval (for general questions)
    shouldUseRAG(intent.intent)
      ? retrieveContext(query, useHybridSearch)
      : Promise.resolve([]),

    // Tool Execution (for specific intents)
    shouldUseTools(intent.intent)
      ? executeToolsForIntent(intent, cookie)
      : Promise.resolve([]),
  ]);

  console.log(`[AI Orchestrator] Retrieved ${ragContexts.length} RAG contexts`);
  console.log(`[AI Orchestrator] Executed ${toolResults.length} tool calls`);

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
  // RAG is used for general questions and as fallback for other intents
  return (
    intent === "general_question" ||
    intent === "device_lookup" ||
    intent === "ticket_lookup"
  );
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
  cookie?: string,
): Promise<ToolCall[]> {
  const toolCalls: Array<{ tool: string; params: Record<string, unknown> }> =
    [];

  switch (intent.intent) {
    case "device_lookup": {
      // Build device search params
      const params: Record<string, unknown> = {};

      if (intent.entities.deviceId) {
        // Specific device lookup
        toolCalls.push({
          tool: "get_device_details",
          params: { device_id: intent.entities.deviceId },
        });
      } else if (
        intent.entities.deviceName ||
        intent.entities.keywords?.length
      ) {
        // Search devices
        params.search =
          intent.entities.deviceName || intent.entities.keywords?.join(" ");
        params.limit = 10;
        toolCalls.push({ tool: "search_devices", params });
      } else {
        // Default: list recent devices
        toolCalls.push({ tool: "search_devices", params: { limit: 10 } });
      }
      break;
    }

    case "ticket_lookup": {
      const params: Record<string, unknown> = { limit: 10 };

      if (intent.entities.ticketId) {
        // Could add get_ticket_details if API supports it
        params.search = intent.entities.ticketId;
      } else if (intent.entities.deviceId) {
        params.device_id = intent.entities.deviceId;
      }

      toolCalls.push({ tool: "search_tickets", params });
      break;
    }

    case "notification_check": {
      // Get unread notifications
      toolCalls.push({
        tool: "get_notifications",
        params: { is_read: false, limit: 20 },
      });
      break;
    }
  }

  if (toolCalls.length === 0) {
    return [];
  }

  try {
    return await executeToolCalls(toolCalls, cookie);
  } catch (error) {
    console.error("[AI Orchestrator] Tool execution failed:", error);
    return toolCalls.map((tc) => ({
      tool: tc.tool,
      params: tc.params,
      error: error instanceof Error ? error.message : "Tool execution failed",
    }));
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

  // Step 2: RAG (if applicable)
  if (shouldUseRAG(intent.intent)) {
    const contexts = await retrieveContext(query, useHybridSearch);
    yield { type: "rag", data: contexts };
  }

  // Step 3: Tools (if applicable)
  if (shouldUseTools(intent.intent)) {
    const tools = await executeToolsForIntent(intent, cookie);
    yield { type: "tools", data: tools };
  }

  // Step 4: Response
  const response = await generateResponse({
    query,
    intent: intent.intent,
    conversationHistory,
  });

  yield { type: "response", data: response };
}
