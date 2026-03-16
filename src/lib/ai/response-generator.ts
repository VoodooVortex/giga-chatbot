/**
 * Response Generator using Gemini
 * Generates contextual responses with citations
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "@/lib/config";
import type { RAGContext, ToolCall } from "./types";

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY_CHAT);

interface GenerateResponseOptions {
    query: string;
    intent: string;
    ragContexts?: RAGContext[];
    toolResults?: ToolCall[];
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function generateResponse(options: GenerateResponseOptions): Promise<string> {
    const { query, intent, ragContexts, toolResults, conversationHistory } = options;

    // Build system prompt based on intent
    const systemPrompt = buildSystemPrompt(intent);
    const listInstruction = buildListInstruction(query);

    // Build context from RAG and tool results
    const contextPrompt = buildContextPrompt(ragContexts, toolResults);

    // Build conversation history
    const historyPrompt = buildHistoryPrompt(conversationHistory);

    const fullPrompt = `${systemPrompt}
${listInstruction}

${contextPrompt}

${historyPrompt}

User Query: ${query}

Response:`;

    if (env.LLM_PROVIDER === "openrouter") {
        return generateWithOpenRouter(fullPrompt);
    }

    return generateWithGoogle(fullPrompt);
}

function buildListInstruction(query: string): string {
    if (!/(ทั้งหมด|รายการทั้งหมด|ลิสต์|list all|show all|ทั้งหมด|แสดงทั้งหมด|all devices|all items)/i.test(query)) {
        return "";
    }

    return `User requested the full list. You MUST list every item from System Data without truncation, no summaries, and no ellipsis. If there are no items, state that clearly.`;
}

async function generateWithGoogle(fullPrompt: string): Promise<string> {
    const model = genAI.getGenerativeModel({
        model: env.GOOGLE_MODEL_NAME,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
        }
    });

    const result = await model.generateContent(fullPrompt);
    return result.response.text();
}

async function generateWithOpenRouter(fullPrompt: string): Promise<string> {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let response: Response;
        try {
            response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.OPENROUTER_API_KEY_CHAT}`,
                },
                body: JSON.stringify({
                    model: env.OPENROUTER_MODEL_NAME,
                    temperature: 0.7,
                    max_tokens: 2048,
                    messages: [
                        { role: "user", content: fullPrompt },
                    ],
                }),
            });
        } catch (networkErr) {
            if (attempt === MAX_RETRIES) {
                console.warn(`[OpenRouter] All ${MAX_RETRIES} attempts failed (network). Falling back to Google.`);
                return generateWithGoogle(fullPrompt);
            }
            const delay = 500 * 2 ** (attempt - 1);
            console.warn(`[OpenRouter] Network error on attempt ${attempt}/${MAX_RETRIES}. Retrying in ${delay}ms...`, networkErr);
            await new Promise((r) => setTimeout(r, delay));
            continue;
        }

        if (response.ok) {
            const payload = await response.json() as {
                choices?: Array<{ message?: { content?: string } }>;
            };
            return payload.choices?.[0]?.message?.content?.trim() || "ขออภัย ไม่สามารถสร้างคำตอบได้ในขณะนี้";
        }

        // 5xx → retry; 4xx (client errors) → throw immediately
        if (response.status >= 400 && response.status < 500) {
            const errorText = await response.text();
            throw new Error(`OpenRouter response generation failed: ${response.status} ${errorText}`);
        }

        if (attempt === MAX_RETRIES) {
            console.warn(`[OpenRouter] All ${MAX_RETRIES} attempts returned ${response.status}. Falling back to Google.`);
            return generateWithGoogle(fullPrompt);
        }

        const delay = 500 * 2 ** (attempt - 1);
        console.warn(`[OpenRouter] Attempt ${attempt}/${MAX_RETRIES} returned ${response.status}. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
    }

    // Should never reach here, but TypeScript needs the return
    return generateWithGoogle(fullPrompt);
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
If the answer isn't in the knowledge base, do not blindly apologize. Instead, politely clarify what the user means (e.g. asking if they are looking for an Asset ID, Ticket ID, or if it is a general question). If it is completely out of scope, then suggest contacting IT.`
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
                        const name = d.de_name || d.name || d.assetTag || "Unknown";
                        const location = d.de_location || d.location || "N/A";
                        parts.push(`  • ${name} (Location: ${location})`);
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
                    parts.push(`📦 Device: ${d.de_name || d.name || d.assetTag}`);
                    parts.push(`   Serial: ${d.de_serial_number || d.serial || "N/A"}`);
                    parts.push(`   Location: ${d.de_location || d.location || "N/A"}`);
                    parts.push(`   Description: ${d.de_description || d.description || "N/A"}`);
                }
                break;
            }

            case "search_tickets":
            case "search_issues": {
                const tickets = Array.isArray(result) ? result : [];
                if (tickets.length === 0) {
                    parts.push("🎫 No tickets found matching your criteria.");
                } else {
                    parts.push(`🎫 Found ${tickets.length} ticket(s):`);
                    tickets.slice(0, 5).forEach((t: Record<string, unknown>) => {
                        const id = t.ti_id || t.id || "N/A";
                        const title = t.ti_title || t.title || t.subject || "Untitled";
                        const status = t.ti_status || t.status || "Unknown";
                        parts.push(`  • #${id}: ${title} (${status})`);
                    });
                    if (tickets.length > 5) {
                        parts.push(`  ... and ${tickets.length - 5} more`);
                    }
                }
                break;
            }

            case "get_notifications": {
                const notifications = Array.isArray(result) ? result : [];
                const unread = notifications.filter((n: Record<string, unknown>) => {
                    if ("nr_status" in n) return n.nr_status === "UNREAD";
                    if ("read_at" in n) return !n.read_at;
                    return !(n as { isRead?: boolean }).isRead;
                });
                if (notifications.length === 0) {
                    parts.push("🔔 No notifications.");
                } else {
                    parts.push(`🔔 ${unread.length} unread of ${notifications.length} total notifications`);
                }
                break;
            }

            case "list_devices_with_availability": {
                const devices = Array.isArray(result) ? result : [];
                if (devices.length === 0) {
                    parts.push("📦 No available devices found.");
                } else {
                    parts.push(`📦 Available devices: ${devices.length} item(s)`);
                    devices.slice(0, 5).forEach((d: Record<string, unknown>) => {
                        const name = d.de_name || d.name || "Unknown";
                        const available = d.available ?? "N/A";
                        const total = d.total ?? "N/A";
                        parts.push(`  • ${name} (Ready: ${available}/${total})`);
                    });
                    if (devices.length > 5) {
                        parts.push(`  ... and ${devices.length - 5} more`);
                    }
                }
                break;
            }

            case "get_device_borrow_summary": {
                if (!result) {
                    parts.push("📦 Device summary not found.");
                } else {
                    const d = result as Record<string, unknown>;
                    parts.push(`📦 ${d.de_name || d.name || "Device"}: Ready ${d.ready ?? "?"}/${d.total ?? "?"}`);
                }
                break;
            }

            case "get_device_children_availability": {
                const children = Array.isArray(result) ? result : [];
                const readyCount = children.filter((c: Record<string, unknown>) => c.dec_status === "READY").length;
                parts.push(`📦 Device children: ${children.length} total, ${readyCount} ready`);
                break;
            }

            case "get_device_available_for_ticket": {
                const children = Array.isArray(result) ? result : [];
                parts.push(`📦 Available for selected dates: ${children.length} device(s)`);
                break;
            }

            case "find_device_child_by_asset_code": {
                const payload = result as { asset_code?: string; matches?: Array<Record<string, unknown>> };
                const matches = Array.isArray(payload?.matches) ? payload.matches : [];
                if (matches.length === 0) {
                    parts.push(`📦 No device child found for asset code ${payload?.asset_code || ""}.`);
                } else {
                    const first = matches[0] as Record<string, unknown>;
                    const device = first.device as Record<string, unknown> | undefined;
                    const child = first.child as Record<string, unknown> | undefined;
                    const available = first.available === true ? "READY" : "NOT READY";
                    parts.push(`📦 Asset: ${payload.asset_code}`);
                    if (device) {
                        parts.push(`   Device: ${device.de_name || device.name || "Unknown"} (ID: ${device.de_id ?? "N/A"})`);
                    }
                    if (child) {
                        parts.push(`   Child: ${child.dec_asset_code || "N/A"} (Status: ${child.dec_status || "N/A"}, ${available})`);
                    }
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
