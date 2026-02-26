/**
 * Tool Definitions and Executors
 * Defines tools for device lookup, ticket lookup, and notification management
 */

import {
    getDevices,
    getDevice,
    getIssues,
    getNotifications,
    markNotificationsAsRead
} from "@/lib/api-client";
import type { ToolDefinition, ToolCall } from "./types";

// Tool definitions for Gemini function calling
export const TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        name: "search_devices",
        description: "Search for devices/assets in the inventory system. Use when user asks about devices, assets, or equipment.",
        parameters: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Search term for device name, tag, or description"
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: 10)"
                }
            },
            required: []
        }
    },
    {
        name: "get_device_details",
        description: "Get detailed information about a specific device by ID",
        parameters: {
            type: "object",
            properties: {
                device_id: {
                    type: "number",
                    description: "Device ID (numeric)"
                }
            },
            required: ["device_id"]
        }
    },
    {
        name: "search_issues",
        description: "Search for issues/tickets in the system. Use when user asks about problems, issues, or tickets.",
        parameters: {
            type: "object",
            properties: {
                status: {
                    type: "string",
                    description: "Filter by issue status",
                    enum: ["PENDING", "IN_PROGRESS", "COMPLETED"]
                },
                de_id: {
                    type: "number",
                    description: "Filter by related device ID"
                },
                q: {
                    type: "string",
                    description: "Search query string"
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: 10)"
                }
            },
            required: []
        }
    },
    {
        name: "get_notifications",
        description: "Get user's notifications. Use when user asks about alerts or notifications.",
        parameters: {
            type: "object",
            properties: {
                unread: {
                    type: "boolean",
                    description: "Filter by read status (true = unread only, false = all)"
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: 10)"
                }
            },
            required: []
        }
    },
    {
        name: "mark_notifications_read",
        description: "Mark notifications as read. Use when user wants to clear or read notifications.",
        parameters: {
            type: "object",
            properties: {
                notification_ids: {
                    type: "array",
                    description: "Array of notification IDs to mark as read"
                }
            },
            required: ["notification_ids"]
        }
    }
];

// Tool executor functions
export async function executeTool(
    toolName: string,
    params: Record<string, unknown>,
    cookie?: string
): Promise<unknown> {
    switch (toolName) {
        case "search_devices": {
            const { search, limit } = params as { search?: string; limit?: number };
            const result = await getDevices({
                search,
                limit: limit || 10
            }, cookie);
            return result.data;
        }

        case "get_device_details": {
            const { device_id } = params as { device_id: number };
            return await getDevice(device_id, cookie);
        }

        case "search_issues": {
            const { status, de_id, q, limit } = params as {
                status?: "PENDING" | "IN_PROGRESS" | "COMPLETED";
                de_id?: number;
                q?: string;
                limit?: number;
            };
            const result = await getIssues({
                status,
                de_id,
                q,
                limit: limit || 10
            }, cookie);
            return result.data;
        }

        case "get_notifications": {
            const { unread, limit } = params as { unread?: boolean; limit?: number };
            return await getNotifications({
                unread,
                limit: limit || 10
            }, cookie);
        }

        case "mark_notifications_read": {
            const { notification_ids } = params as { notification_ids: number[] };
            await markNotificationsAsRead(notification_ids, cookie);
            return { success: true, marked_count: notification_ids.length };
        }

        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

/**
 * Execute multiple tool calls and return results
 */
export async function executeToolCalls(
    toolCalls: Array<{ tool: string; params: Record<string, unknown> }>,
    cookie?: string
): Promise<ToolCall[]> {
    const results: ToolCall[] = [];

    for (const call of toolCalls) {
        try {
            const result = await executeTool(call.tool, call.params, cookie);
            results.push({
                tool: call.tool,
                params: call.params,
                result
            });
        } catch (error) {
            console.error("[Tools] Tool call failed:", {
                tool: call.tool,
                params: call.params,
                error: error instanceof Error ? error.message : error,
            });
            results.push({
                tool: call.tool,
                params: call.params,
                error: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    return results;
}
