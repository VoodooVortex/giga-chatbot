/**
 * Tool Definitions and Executors
 * Defines tools for device lookup, ticket lookup, and notification management
 */

import {
    getDevices,
    getDevice,
    getDeviceWithChilds,
    getBorrowAvailableDeviceChildren,
    getBorrowDeviceSummary,
    getBorrowInventory,
    getIssues,
    getTicketDeviceAvailableChildren,
    getNotifications,
    markNotificationsAsRead
} from "@/lib/api-client";
import { logger } from "@/lib/observability/logger";
import { logToolCall } from "@/lib/observability/audit";
import { metrics } from "@/lib/observability/metrics";
import type { ToolDefinition, ToolCall } from "./types";

const TOOL_REQUEST_METRIC = "tool_requests_total";
const TOOL_DURATION_METRIC = "tool_request_duration_ms";

function normalizeLookupValue(value: string | null | undefined): string {
    return (value ?? "")
        .toLowerCase()
        .replace(/[\s/_-]+/g, "")
        .trim();
}

function matchesDeviceSearch(
    search: string,
    fields: Array<string | null | undefined>
): boolean {
    const rawTerm = search.trim().toLowerCase();
    if (!rawTerm) return false;

    const normalizedTerm = normalizeLookupValue(search);

    return fields.some((field) => {
        const rawField = (field ?? "").toLowerCase();
        if (!rawField) return false;
        if (rawField.includes(rawTerm)) return true;

        const normalizedField = normalizeLookupValue(field);
        return normalizedTerm.length > 0 && normalizedField.includes(normalizedTerm);
    });
}

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
        name: "list_devices_with_availability",
        description: "List devices with availability counts (ready/total). Use when user asks for available devices.",
        parameters: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Optional search term to filter device name, serial, location, or category"
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: all)"
                },
                only_available: {
                    type: "boolean",
                    description: "Return only devices with available > 0"
                }
            },
            required: []
        }
    },
    {
        name: "get_device_borrow_summary",
        description: "Get device summary for borrowing, including ready/total counts.",
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
        name: "get_device_children_availability",
        description: "Get device child availability (current status + active borrow windows).",
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
        name: "get_device_available_for_ticket",
        description: "Get device child availability for a date range (ticket context).",
        parameters: {
            type: "object",
            properties: {
                device_id: {
                    type: "number",
                    description: "Device ID (numeric)"
                },
                device_child_ids: {
                    type: "array",
                    description: "Optional list of device child IDs"
                },
                start_date: {
                    type: "string",
                    description: "Start date (YYYY-MM-DD)"
                },
                end_date: {
                    type: "string",
                    description: "End date (YYYY-MM-DD)"
                }
            },
            required: ["device_id", "start_date", "end_date"]
        }
    },
    {
        name: "find_device_child_by_asset_code",
        description: "Find a device child by asset code across all devices.",
        parameters: {
            type: "object",
            properties: {
                asset_code: {
                    type: "string",
                    description: "Asset code to search for (e.g., ASSET-LAP-DELL-001)"
                },
                max_devices: {
                    type: "number",
                    description: "Maximum number of devices to scan (safety cap)"
                }
            },
            required: ["asset_code"]
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

        case "list_devices_with_availability": {
            const { search, limit, only_available } = params as {
                search?: string;
                limit?: number;
                only_available?: boolean;
            };
            let result = await getBorrowInventory(cookie);

            if (only_available) {
                result = result.filter((d) => (d.available ?? 0) > 0);
            }

            if (search && search.trim()) {
                result = result.filter((d) => {
                    const fields = [
                        d.de_name,
                        d.de_serial_number,
                        d.de_location,
                        d.category,
                        d.department ?? "",
                        d.sub_section ?? "",
                    ];
                    return matchesDeviceSearch(search, fields);
                });
            }

            if (typeof limit === "number" && limit > 0) {
                result = result.slice(0, limit);
            }

            return result;
        }

        case "get_device_borrow_summary": {
            const { device_id } = params as { device_id: number };
            return await getBorrowDeviceSummary(device_id, cookie);
        }

        case "get_device_children_availability": {
            const { device_id } = params as { device_id: number };
            return await getBorrowAvailableDeviceChildren(device_id, cookie);
        }

        case "get_device_available_for_ticket": {
            const { device_id, device_child_ids, start_date, end_date } = params as {
                device_id: number;
                device_child_ids?: number[];
                start_date: string;
                end_date: string;
            };
            return await getTicketDeviceAvailableChildren(
                {
                    deviceId: device_id,
                    deviceChildIds: device_child_ids,
                    startDate: start_date,
                    endDate: end_date,
                },
                cookie
            );
        }

        case "find_device_child_by_asset_code": {
            const { asset_code, max_devices } = params as { asset_code: string; max_devices?: number };
            if (!asset_code || !asset_code.trim()) {
                throw new Error("asset_code is required");
            }

            const target = asset_code.trim().toUpperCase();
            const devices = await getBorrowInventory(cookie);

            const cap =
                typeof max_devices === "number" && max_devices > 0
                    ? Math.floor(max_devices)
                    : devices.length;
            const scanList = devices.slice(0, cap);

            for (let i = 0; i < scanList.length; i++) {
                const device = scanList[i];
                const deviceWithChilds = await getDeviceWithChilds(device.de_id, cookie);
                const children = Array.isArray(deviceWithChilds?.device_childs)
                    ? deviceWithChilds.device_childs
                    : [];
                const match = children.find(
                    (child) => (child.dec_asset_code || "").toUpperCase() === target
                );

                if (match) {
                    const isReady = match.dec_status === "READY";
                    return {
                        asset_code: target,
                        matches: [
                            {
                                device,
                                child: match,
                                available: isReady,
                            },
                        ],
                        scanned: i + 1,
                        truncated: scanList.length < devices.length,
                    };
                }
            }

            return {
                asset_code: target,
                matches: [],
                scanned: scanList.length,
                truncated: scanList.length < devices.length,
            };
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

        case "search_tickets": {
            // Alias for search_issues (legacy name)
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
            const { unread, is_read, limit } = params as {
                unread?: boolean;
                is_read?: boolean;
                limit?: number;
            };
            const normalizedUnread =
                typeof unread === "boolean"
                    ? unread
                    : typeof is_read === "boolean"
                        ? !is_read
                        : undefined;
            const response = await getNotifications({
                unread: normalizedUnread,
                limit: limit || 20,
                page: 1,
            }, cookie);

            const payload =
                response && typeof response === "object" && "data" in response
                    ? (response as { data?: unknown[]; total?: number; page?: number; limit?: number; maxPage?: number })
                    : { data: Array.isArray(response) ? response : [] };

            let notifications = Array.isArray(payload.data) ? payload.data : [];

            if (normalizedUnread === true) {
                notifications = notifications.filter((n) => {
                    if (n && typeof n === "object") {
                        const record = n as Record<string, unknown>;
                        if ("nr_status" in record) return record.nr_status === "UNREAD";
                        if ("status" in record) return record.status === "UNREAD";
                        if ("read_at" in record) return !record.read_at;
                        if ("isRead" in record) return !record.isRead;
                    }
                    return true;
                });
            }

            return {
                notifications,
                meta: {
                    total: typeof payload.total === "number" ? payload.total : notifications.length,
                    page: typeof payload.page === "number" ? payload.page : 1,
                    limit: typeof payload.limit === "number" ? payload.limit : notifications.length,
                    maxPage: typeof payload.maxPage === "number" ? payload.maxPage : 1,
                },
            };
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
    cookie?: string,
    context?: { requestId?: string }
): Promise<ToolCall[]> {
    const results: ToolCall[] = [];

    for (const call of toolCalls) {
        const startedAt = Date.now();
        try {
            const result = await executeTool(call.tool, call.params, cookie);
            const durationMs = Date.now() - startedAt;
            recordToolMetrics(call.tool, "success", durationMs);
            if (context?.requestId) {
                logToolCall(call.tool, call.params, result, {
                    requestId: context.requestId,
                });
            }
            logger.info("[Tools] tool call succeeded", {
                requestId: context?.requestId,
                tool: call.tool,
                durationMs,
            });
            results.push({
                tool: call.tool,
                params: call.params,
                result
            });
        } catch (error) {
            const durationMs = Date.now() - startedAt;
            console.error("[Tools] Tool call failed:", {
                tool: call.tool,
                params: call.params,
                error: error instanceof Error ? error.message : error,
            });
            recordToolMetrics(call.tool, "error", durationMs);
            if (context?.requestId) {
                logToolCall(call.tool, call.params, undefined, {
                    requestId: context.requestId,
                });
            }
            logger.warn("[Tools] tool call failed", {
                requestId: context?.requestId,
                tool: call.tool,
                durationMs,
                error: error instanceof Error ? error.message : "Unknown error",
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

function recordToolMetrics(tool: string, status: "success" | "error", durationMs: number): void {
    const labels = { tool, status };
    metrics.counter(TOOL_REQUEST_METRIC, labels);
    metrics.histogram(TOOL_DURATION_METRIC, durationMs, labels);
}
