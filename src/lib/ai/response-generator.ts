/**
 * Response Generator using Gemini
 * Generates contextual responses with citations
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { RAGContext, ToolCall } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);

interface GenerateResponseOptions {
    query: string;
    intent: string;
    ragContexts?: RAGContext[];
    toolResults?: ToolCall[];
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function generateResponse(options: GenerateResponseOptions): Promise<string> {
    const { query, intent, ragContexts, toolResults, conversationHistory } = options;

    const model = genAI.getGenerativeModel({
        model: env.GOOGLE_MODEL_NAME,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
        }
    });

    // Build system prompt based on intent
    const systemPrompt = buildSystemPrompt(intent);

    // Build context from RAG and tool results
    const contextPrompt = buildContextPrompt(ragContexts, toolResults);

    // Build conversation history
    const historyPrompt = buildHistoryPrompt(conversationHistory);

    const fullPrompt = `${systemPrompt}

${contextPrompt}

${historyPrompt}

User Query: ${query}

Response:`;

    const result = await model.generateContent(fullPrompt);
    return result.response.text();
}

function buildSystemPrompt(intent: string): string {
    const basePrompt = `You are Giga, an AI assistant for Orbis Track - an IT Asset Management system.
You help users with:
- Finding devices and assets
- Looking up tickets and issues  
- Checking notifications
- Answering IT-related questions

Guidelines:
- Be concise and professional
- Use Thai language for Thai queries, English for English queries
- If you don't know something, say so honestly
- Always cite your sources when using retrieved information`;

    const intentSpecificPrompts: Record<string, string> = {
        device_lookup: `
You are helping with device/asset lookup. 
Provide relevant details like: device name, status, location, assigned user, and specifications.
If device not found, suggest checking the search terms or contacting IT support.`,

        ticket_lookup: `
You are helping with ticket/issue lookup.
Provide: ticket ID, status, priority, description, and resolution steps if available.
Summarize multiple tickets if there are many results.`,

        notification_check: `
You are helping check notifications.
List unread notifications first, then offer to mark them as read.
Summarize notification content briefly.`,

        general_question: `
You are answering general IT questions using the knowledge base.
Provide accurate, helpful information with citations to the source documents.
If the answer isn't in the knowledge base, suggest contacting IT support.`
    };

    return basePrompt + (intentSpecificPrompts[intent] || "");
}

function buildContextPrompt(
    ragContexts?: RAGContext[],
    toolResults?: ToolCall[]
): string {
    const parts: string[] = [];

    // Add RAG contexts
    if (ragContexts && ragContexts.length > 0) {
        parts.push("Retrieved Knowledge Base Context:");
        ragContexts.forEach((ctx, i) => {
            parts.push(`[${i + 1}] Source: ${ctx.source} (Similarity: ${(ctx.similarity * 100).toFixed(1)}%)`);
            parts.push(`Content: ${ctx.content}`);
            parts.push("");
        });
    }

    // Add tool results
    if (toolResults && toolResults.length > 0) {
        parts.push("System Data:");
        toolResults.forEach((tool, i) => {
            parts.push(`Tool: ${tool.tool}`);
            if (tool.error) {
                parts.push(`Error: ${tool.error}`);
            } else {
                parts.push(`Result: ${JSON.stringify(tool.result, null, 2)}`);
            }
            parts.push("");
        });
    }

    return parts.join("\n") || "No additional context available.";
}

function buildHistoryPrompt(
    history?: Array<{ role: "user" | "assistant"; content: string }>
): string {
    if (!history || history.length === 0) {
        return "";
    }

    const parts = ["Conversation History:"];
    history.slice(-5).forEach(msg => {
        parts.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
    });

    return parts.join("\n");
}

/**
 * Format tool results into a human-readable summary
 */
export function formatToolResultsForDisplay(toolResults: ToolCall[]): string {
    const parts: string[] = [];

    for (const tool of toolResults) {
        if (tool.error) {
            parts.push(`❌ ${tool.tool}: ${tool.error}`);
            continue;
        }

        const result = tool.result;

        switch (tool.tool) {
            case "search_devices": {
                const devices = Array.isArray(result) ? result : [];
                if (devices.length === 0) {
                    parts.push("📦 No devices found matching your criteria.");
                } else {
                    parts.push(`📦 Found ${devices.length} device(s):`);
                    devices.slice(0, 5).forEach((d: Record<string, unknown>) => {
                        parts.push(`  • ${d.name || d.assetTag || "Unknown"} (${d.status || "Unknown status"})`);
                    });
                    if (devices.length > 5) {
                        parts.push(`  ... and ${devices.length - 5} more`);
                    }
                }
                break;
            }

            case "get_device_details": {
                if (!result) {
                    parts.push("📦 Device not found.");
                } else {
                    const d = result as Record<string, unknown>;
                    parts.push(`📦 Device: ${d.name || d.assetTag}`);
                    parts.push(`   Status: ${d.status}`);
                    parts.push(`   Location: ${d.location || "N/A"}`);
                    parts.push(`   Assigned to: ${d.assignedTo || "Unassigned"}`);
                }
                break;
            }

            case "search_tickets": {
                const tickets = Array.isArray(result) ? result : [];
                if (tickets.length === 0) {
                    parts.push("🎫 No tickets found matching your criteria.");
                } else {
                    parts.push(`🎫 Found ${tickets.length} ticket(s):`);
                    tickets.slice(0, 5).forEach((t: Record<string, unknown>) => {
                        parts.push(`  • #${t.id}: ${t.title || t.subject} (${t.status || "Unknown"})`);
                    });
                    if (tickets.length > 5) {
                        parts.push(`  ... and ${tickets.length - 5} more`);
                    }
                }
                break;
            }

            case "get_notifications": {
                const notifications = Array.isArray(result) ? result : [];
                const unread = notifications.filter((n: Record<string, unknown>) => !n.isRead);
                if (notifications.length === 0) {
                    parts.push("🔔 No notifications.");
                } else {
                    parts.push(`🔔 ${unread.length} unread of ${notifications.length} total notifications`);
                }
                break;
            }

            case "mark_notifications_read": {
                const r = result as { success: boolean; marked_count: number };
                if (r.success) {
                    parts.push(`✅ Marked ${r.marked_count} notification(s) as read.`);
                }
                break;
            }

            default:
                parts.push(`📋 ${tool.tool}: ${JSON.stringify(result)}`);
        }
    }

    return parts.join("\n");
}
