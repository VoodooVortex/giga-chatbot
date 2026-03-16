import { env } from "@/lib/config";

const MAIN_APP_URL = env.MAIN_APP_URL;

// Error types
export class ApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public code: string,
        public requestId?: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

// Request options interface
interface RequestOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: unknown;
    cookie?: string;
}

// Standardized response envelope from Orbis-Track
interface BaseResponse<T> {
    message?: string;
    success?: boolean;
    data?: T;
    traceStack?: string;
}

/**
 * Make a request to the main app API
 */
async function makeRequest<T>(
    endpoint: string,
    options: RequestOptions = {}
): Promise<T> {
    const { method = "GET", headers = {}, body, cookie } = options;

    const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
    };

    // Add cookie if provided (for SSR/auth)
    if (cookie) {
        requestHeaders["Cookie"] = cookie;
    }

    const url = `${MAIN_APP_URL}${endpoint}`;

    try {
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
            // Include credentials for browser requests
            credentials: "include",
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new ApiError(
                data?.message || `HTTP ${response.status}`,
                response.status,
                data?.code || "UNKNOWN_ERROR",
                data?.request_id
            );
        }

        return data as T;
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(
            error instanceof Error ? error.message : "Network error",
            0,
            "NETWORK_ERROR"
        );
    }
}

// ============================================================================
// Auth API
// ============================================================================

export interface SessionResponse {
    message: string;
    data: {
        user: {
            sub: number;
            role: string;
            dept?: number;
            sec?: number;
        };
        roles: string[];
        exp: number;
    };
}

export async function getSession(cookie?: string): Promise<SessionResponse> {
    return makeRequest<SessionResponse>("/api/auth/session", { cookie });
}

// ============================================================================
// Devices API (Updated to match contract: /api/v1/inventory)
// ============================================================================

export interface Device {
    de_id: number;
    de_serial_number: string;
    de_name: string;
    de_description: string | null;
    de_location: string;
    de_max_borrow_days: number;
    de_images: string | null;
    de_af_id: number;
    de_ca_id: number;
    de_us_id: number;
    de_sec_id: number;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
    // Relations (populated by API)
    category?: Category;
    section?: Section;
}

export interface DeviceChild {
    dec_id: number;
    dec_serial_number: string | null;
    dec_asset_code: string;
    dec_has_serial_number: boolean;
    dec_status: "UNAVAILABLE" | "READY" | "BORROWED" | "REPAIRING" | "DAMAGED" | "LOST";
    dec_de_id: number;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface DeviceChildStatus {
    total_childs: number;
    available_count: number;
    borrowed_count: number;
    repairing_count: number;
    damaged_count: number;
    lost_count: number;
    ready_count: number;
}

export interface Category {
    ca_id: number;
    ca_name: string;
}

export interface Section {
    sec_id: number;
    sec_name: string;
    sec_dept_id: number;
}

export interface DevicesListResponse {
    data: Device[];
    meta: {
        total: number;
        page: number;
        limit: number;
    };
}

export async function getDevices(
    params?: {
        page?: number;
        limit?: number;
        search?: string;
        category?: number;
    },
    cookie?: string
): Promise<DevicesListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.search) queryParams.set("search", params.search);
    if (params?.category) queryParams.set("category", params.category.toString());

    const query = queryParams.toString();
    return makeRequest<DevicesListResponse>(
        `/api/v1/inventory${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getDevice(
    id: number,
    cookie?: string
): Promise<Device> {
    return makeRequest<Device>(`/api/v1/inventory/devices/${id}`, { cookie });
}

export async function getDeviceChildStatus(
    cookie?: string
): Promise<DeviceChildStatus> {
    return makeRequest<DeviceChildStatus>("/api/v1/inventory/device-child-status", { cookie });
}

export async function getCategories(cookie?: string): Promise<Category[]> {
    return makeRequest<Category[]>("/api/v1/categories", { cookie });
}

// ============================================================================
// Borrow API (Availability / Borrowing)
// ============================================================================

export interface BorrowInventoryItem {
    de_id: number;
    de_serial_number: string;
    de_name: string;
    de_description: string | null;
    de_location: string;
    de_max_borrow_days: number;
    de_images: string | null;
    category: string;
    department?: string | null;
    sub_section?: string | null;
    total: number;
    available: number;
}

export interface BorrowDeviceAccessory {
    acc_name: string;
    acc_quantity: number;
}

export interface BorrowDeviceSummary {
    de_serial_number: string;
    de_name: string;
    de_description: string | null;
    de_location: string;
    de_max_borrow_days: number;
    de_images: string | null;
    category?: { ca_name: string };
    accessories?: BorrowDeviceAccessory[];
    department?: string | null;
    section?: string | null;
    total: number;
    ready: number;
}

export interface BorrowAvailableDeviceChild {
    dec_id: number;
    dec_serial_number: string | null;
    dec_asset_code: string;
    dec_status: "UNAVAILABLE" | "READY" | "BORROWED" | "REPAIRING" | "DAMAGED" | "LOST";
    activeBorrow: Array<{
        da_start: string;
        da_end: string;
    }>;
}

export interface TicketAvailableDeviceChild {
    dec_id: number;
    dec_serial_number: string | null;
    dec_asset_code: string;
    dec_has_serial_number: boolean;
    dec_status: "UNAVAILABLE" | "READY" | "BORROWED" | "REPAIRING" | "DAMAGED" | "LOST";
    dec_de_id: number;
    deleted_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export async function getBorrowInventory(
    cookie?: string
): Promise<BorrowInventoryItem[]> {
    const res = await makeRequest<BaseResponse<BorrowInventoryItem[]>>(
        "/api/v1/borrow/devices",
        { cookie }
    );
    return res.data ?? [];
}

export async function getBorrowDeviceSummary(
    id: number,
    cookie?: string
): Promise<BorrowDeviceSummary | null> {
    const res = await makeRequest<BaseResponse<BorrowDeviceSummary>>(
        `/api/v1/borrow/devices/${id}`,
        { cookie }
    );
    return res.data ?? null;
}

export async function getBorrowAvailableDeviceChildren(
    id: number,
    cookie?: string
): Promise<BorrowAvailableDeviceChild[]> {
    const res = await makeRequest<BaseResponse<BorrowAvailableDeviceChild[]>>(
        `/api/v1/borrow/available/${id}`,
        { cookie }
    );
    return res.data ?? [];
}

export async function getTicketDeviceAvailableChildren(
    params: {
        deviceId: number;
        deviceChildIds?: number[];
        startDate: string;
        endDate: string;
    },
    cookie?: string
): Promise<TicketAvailableDeviceChild[]> {
    const queryParams = new URLSearchParams();
    queryParams.set("deviceId", params.deviceId.toString());
    if (params.deviceChildIds && params.deviceChildIds.length > 0) {
        for (const id of params.deviceChildIds) {
            queryParams.append("deviceChildIds", id.toString());
        }
    }
    queryParams.set("startDate", params.startDate);
    queryParams.set("endDate", params.endDate);

    const res = await makeRequest<BaseResponse<TicketAvailableDeviceChild[]>>(
        `/api/v1/tickets/borrow-return/device-available?${queryParams.toString()}`,
        { cookie }
    );
    return res.data ?? [];
}

// ============================================================================
// Tickets API (Updated to match contract: /api/v1/tickets/borrow-return)
// ============================================================================

export interface BorrowReturnTicket {
    brt_id: number;
    brt_status: "PENDING" | "APPROVED" | "IN_USE" | "OVERDUE" | "COMPLETED" | "REJECTED";
    brt_user: string;
    brt_phone: string;
    brt_usage_location: string;
    brt_borrow_purpose: string;
    brt_start_date: string;
    brt_end_date: string;
    brt_quantity: number;
    brt_current_stage: number | null;
    brt_reject_reason: string | null;
    brt_pickup_location: string | null;
    brt_pickup_datetime: string | null;
    brt_return_location: string | null;
    brt_return_datetime: string | null;
    brt_af_id: number | null;
    brt_user_id: number;
    brt_staff_id: number | null;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
    // Relations
    requester?: {
        us_id: number;
        us_firstname: string;
        us_lastname: string;
    };
}

export interface TicketsListResponse {
    data: BorrowReturnTicket[];
    meta: {
        total: number;
        page: number;
        limit: number;
    };
}

export async function getBorrowReturnTickets(
    params?: {
        page?: number;
        limit?: number;
        status?: "PENDING" | "APPROVED" | "IN_USE" | "OVERDUE" | "COMPLETED" | "REJECTED";
        user_id?: number;
        date_from?: string;
        date_to?: string;
    },
    cookie?: string
): Promise<TicketsListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.status) queryParams.set("status", params.status);
    if (params?.user_id) queryParams.set("user_id", params.user_id.toString());
    if (params?.date_from) queryParams.set("date_from", params.date_from);
    if (params?.date_to) queryParams.set("date_to", params.date_to);

    const query = queryParams.toString();
    return makeRequest<TicketsListResponse>(
        `/api/v1/tickets/borrow-return${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getBorrowReturnTicket(
    id: number,
    cookie?: string
): Promise<BorrowReturnTicket> {
    return makeRequest<BorrowReturnTicket>(`/api/v1/tickets/borrow-return/${id}`, {
        cookie,
    });
}

// ============================================================================
// Issues API (Updated to match contract: /api/v1/history-issue)
// ============================================================================

export interface TicketIssue {
    ti_id: number;
    ti_de_id: number;
    ti_brt_id: number | null;
    ti_title: string;
    ti_description: string;
    ti_reported_by: number;
    ti_assigned_to: number | null;
    ti_status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
    ti_result: "SUCCESS" | "FAILED" | "IN_PROGRESS";
    ti_damaged_reason: string | null;
    ti_resolved_note: string | null;
    receive_at: string | null;
    success_at: string | null;
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
    // Relations
    device?: Device;
    reporter?: {
        us_id: number;
        us_firstname: string;
        us_lastname: string;
    };
    assignee?: {
        us_id: number;
        us_firstname: string;
        us_lastname: string;
    };
}

export interface IssuesListResponse {
    data: TicketIssue[];
    meta: {
        total: number;
        page: number;
        limit: number;
    };
}

export async function getIssues(
    params?: {
        page?: number;
        limit?: number;
        status?: "PENDING" | "IN_PROGRESS" | "COMPLETED";
        de_id?: number;
        brt_id?: number;
        q?: string;
    },
    cookie?: string
): Promise<IssuesListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.status) queryParams.set("status", params.status);
    if (params?.de_id) queryParams.set("de_id", params.de_id.toString());
    if (params?.brt_id) queryParams.set("brt_id", params.brt_id.toString());
    if (params?.q) queryParams.set("q", params.q);

    const query = queryParams.toString();
    return makeRequest<IssuesListResponse>(
        `/api/v1/history-issue${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getIssue(
    id: number,
    cookie?: string
): Promise<TicketIssue> {
    return makeRequest<TicketIssue>(`/api/v1/history-issue/${id}`, { cookie });
}

// ============================================================================
// Notifications API (Updated to match contract)
// ============================================================================

export interface Notification {
    n_id: number;
    n_title: string;
    n_message: string;
    n_data: unknown | null;
    n_target_route: string | null;
    n_base_event: string | null;
    n_brt_id: number | null;
    n_brts_id: number | null;
    n_ti_id: number | null;
    created_at: string;
    send_at: string | null;
    // Recipient info
    nr_status?: "UNREAD" | "READ" | "DISMISSED";
    read_at?: string | null;
}

export async function getNotifications(
    params?: { unread?: boolean; limit?: number; page?: number },
    cookie?: string
): Promise<Notification[]> {
    const queryParams = new URLSearchParams();
    if (params?.unread) queryParams.set("unread", "true");
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.page) queryParams.set("page", params.page.toString());

    const query = queryParams.toString();
    return makeRequest<Notification[]>(
        `/api/v1/notifications${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function markNotificationsAsRead(
    ids: number[],
    cookie?: string
): Promise<void> {
    await makeRequest<void>("/api/v1/notifications/read", {
        method: "PATCH",
        body: { ids },
        cookie,
    });
}

// ============================================================================
// Chat API (Existing Orbis-Track Chat)
// ============================================================================

export interface ChatRoom {
    cr_id: number;
    cr_us_id: number;
    cr_title: string | null;
    created_at: string;
    updated_at: string | null;
    last_msg_at: string | null;
}

export interface ChatMessage {
    cm_id: number;
    cm_role: "user" | "assistant" | "system" | "tool";
    cm_content: string;
    cm_content_json: unknown | null;
    cm_status: "ok" | "error" | "blocked";
    cm_parent_id: number | null;
    cm_cr_id: number;
    created_at: string;
}

export async function getChatRooms(cookie?: string): Promise<ChatRoom[]> {
    return makeRequest<ChatRoom[]>("/api/v1/chat/rooms", { cookie });
}

export async function getChatRoom(
    roomId: number,
    cookie?: string
): Promise<ChatRoom & { messages: ChatMessage[] }> {
    return makeRequest<ChatRoom & { messages: ChatMessage[] }>(
        `/api/v1/chat/rooms/${roomId}`,
        { cookie }
    );
}

export async function createChatRoom(
    title: string | null,
    cookie?: string
): Promise<ChatRoom> {
    return makeRequest<ChatRoom>("/api/v1/chat/rooms", {
        method: "POST",
        body: { title },
        cookie,
    });
}

export async function createChatMessage(
    roomId: number,
    content: string,
    role: "user" | "assistant" | "system" | "tool" = "user",
    cookie?: string
): Promise<ChatMessage> {
    return makeRequest<ChatMessage>(`/api/v1/chat/rooms/${roomId}/messages`, {
        method: "POST",
        body: { content, role },
        cookie,
    });
}

// ============================================================================
// Health Check Endpoints
// ============================================================================

export interface HealthResponse {
    status: string;
    timestamp: string;
}

export interface ReadinessResponse {
    status: string;
    checks: {
        database: string;
    };
    timestamp: string;
}

export async function getHealth(): Promise<HealthResponse> {
    return makeRequest<HealthResponse>("/api/healthz");
}

export async function getReadiness(): Promise<ReadinessResponse> {
    return makeRequest<ReadinessResponse>("/api/readyz");
}
