/**
 * AI Orchestration Types
 * Defines types for LangGraph-based AI workflow
 */

export type IntentType =
    | "device_lookup"      // ค้นหาอุปกรณ์
    | "ticket_lookup"      // ค้นหา ticket/issue
    | "notification_check" // เช็คการแจ้งเตือน
    | "general_question";  // ถามทั่วไปที่ใช้ RAG

export interface ClassifiedIntent {
    intent: IntentType;
    confidence: number;
    entities: {
        deviceId?: string;
        deviceName?: string;
        ticketId?: string;
        keywords?: string[];
    };
}

export interface RAGContext {
    content: string;
    source: string;
    similarity: number;
}

export interface ToolCall {
    tool: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
}

export interface AIState {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    intent?: ClassifiedIntent;
    ragContexts?: RAGContext[];
    toolCalls?: ToolCall[];
    response?: string;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required: string[];
    };
}
