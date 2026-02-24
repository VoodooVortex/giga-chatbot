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
    user: {
        id: string;
        roles: string[];
    };
    exp: number;
}

export async function getSession(cookie?: string): Promise<SessionResponse> {
    return makeRequest<SessionResponse>("/api/auth/session", { cookie });
}

// ============================================================================
// Devices API
// ============================================================================

export interface Device {
    de_id: number;
    de_name: string;
    de_description?: string;
    de_location?: string;
    de_ca_id?: number;
    de_status?: string;
    // Add other device fields as needed
}

export interface DeviceStatus {
    de_id: number;
    status: string;
    child_count: number;
    available_count: number;
}

export interface DevicesListResponse {
    data: Device[];
    total: number;
    page: number;
    limit: number;
}

export async function getDevices(
    params?: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
    },
    cookie?: string
): Promise<DevicesListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.search) queryParams.set("q", params.search);
    if (params?.status) queryParams.set("status", params.status);

    const query = queryParams.toString();
    return makeRequest<DevicesListResponse>(
        `/api/devices${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getDevice(
    id: number,
    cookie?: string
): Promise<Device> {
    return makeRequest<Device>(`/api/devices/${id}`, { cookie });
}

export async function getDeviceStatus(
    id: number,
    cookie?: string
): Promise<DeviceStatus> {
    return makeRequest<DeviceStatus>(`/api/devices/${id}/status`, { cookie });
}

// ============================================================================
// Tickets API
// ============================================================================

export interface BorrowReturnTicket {
    brt_id: number;
    brt_status: string;
    brt_user_id: string;
    brt_start_date?: string;
    brt_end_date?: string;
    brt_af_id?: number;
    // Add other fields as needed
}

export interface TicketsListResponse {
    data: BorrowReturnTicket[];
    total: number;
}

export async function getBorrowReturnTickets(
    params?: {
        status?: string;
        user_id?: string;
        date_from?: string;
        date_to?: string;
    },
    cookie?: string
): Promise<TicketsListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set("status", params.status);
    if (params?.user_id) queryParams.set("user_id", params.user_id);
    if (params?.date_from) queryParams.set("date_from", params.date_from);
    if (params?.date_to) queryParams.set("date_to", params.date_to);

    const query = queryParams.toString();
    return makeRequest<TicketsListResponse>(
        `/api/tickets/borrow-return${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getBorrowReturnTicket(
    id: number,
    cookie?: string
): Promise<BorrowReturnTicket> {
    return makeRequest<BorrowReturnTicket>(`/api/tickets/borrow-return/${id}`, {
        cookie,
    });
}

// ============================================================================
// Issues API
// ============================================================================

export interface TicketIssue {
    ti_id: number;
    ti_title: string;
    ti_description?: string;
    ti_status: string;
    ti_result?: string;
    ti_resolved_note?: string;
    ti_de_id?: number;
    ti_brt_id?: number;
    // Add other fields as needed
}

export interface IssuesListResponse {
    data: TicketIssue[];
    total: number;
}

export async function getIssues(
    params?: {
        status?: string;
        de_id?: number;
        brt_id?: number;
        q?: string;
    },
    cookie?: string
): Promise<IssuesListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set("status", params.status);
    if (params?.de_id) queryParams.set("de_id", params.de_id.toString());
    if (params?.brt_id) queryParams.set("brt_id", params.brt_id.toString());
    if (params?.q) queryParams.set("q", params.q);

    const query = queryParams.toString();
    return makeRequest<IssuesListResponse>(
        `/api/issues${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function getIssue(
    id: number,
    cookie?: string
): Promise<TicketIssue> {
    return makeRequest<TicketIssue>(`/api/issues/${id}`, { cookie });
}

// ============================================================================
// Notifications API
// ============================================================================

export interface Notification {
    id: number;
    title: string;
    message: string;
    read: boolean;
    created_at: string;
}

export async function getNotifications(
    params?: { unread?: boolean },
    cookie?: string
): Promise<Notification[]> {
    const queryParams = new URLSearchParams();
    if (params?.unread) queryParams.set("unread", "true");

    const query = queryParams.toString();
    return makeRequest<Notification[]>(
        `/api/notifications${query ? `?${query}` : ""}`,
        { cookie }
    );
}

export async function markNotificationAsRead(
    id: number,
    cookie?: string
): Promise<void> {
    await makeRequest<void>(`/api/notifications/${id}/read`, {
        method: "POST",
        cookie,
    });
}