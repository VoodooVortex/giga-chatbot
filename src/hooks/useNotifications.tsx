"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationItemProps } from "@/components/Notification";
import { getAuthHeader } from "@/lib/auth/client";

interface NotificationDto {
  n_id: number;
  n_title: string;
  n_message: string;
  n_target_route?: string | null;
  created_at: string;
  send_at?: string | null;
  status?: "UNREAD" | "READ" | "DISMISSED";
  nr_status?: "UNREAD" | "READ" | "DISMISSED";
  event?: string | null;
  n_base_event?: string | null;
  nr_id?: number;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  maxPage: number;
  paginated?: boolean;
}

const PAGE_SIZE = 10;

const mapEventType = (event?: string | null): NotificationItemProps["type"] => {
  switch (event) {
    case "YOUR_TICKET_APPROVED":
      return "approved";
    case "YOUR_TICKET_IN_USE":
      return "in_use";
    case "YOUR_TICKET_RETURNED":
      return "returned";
    case "DUE_SOON_REMINDER":
      return "warning";
    case "OVERDUE_ALERT":
      return "overdue";
    case "ISSUE_NEW_FOR_TECH":
      return "repair_new";
    case "ISSUE_ASSIGNED_TO_YOU":
      return "repair_new";
    case "ISSUE_RESOLVED_FOR_REPORTER":
      return "repair_success";
    case "APPROVAL_REQUESTED":
      return "request_new";
    case "REQUEST_FULFILLED":
      return "request_fulfill";
    case "REQUEST_RESOLVED":
      return "request_resolve";
    case "YOUR_TICKET_REJECTED":
      return "rejected";
    case "YOUR_TICKET_STAGE_APPROVED":
      return "request_pending";
    default:
      return "general";
  }
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const resolveNotificationRoute = (
  route: string | null | undefined,
  basePath: string,
): string | undefined => {
  if (!route) return undefined;
  const trimmed = route.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed === basePath || trimmed.startsWith(`${basePath}/`)) return trimmed;
  if (trimmed.startsWith("/r/")) return `${basePath}${trimmed}`;
  if (/^r\/\d+/i.test(trimmed)) return `${basePath}/${trimmed}`;
  if (trimmed.startsWith("/")) return trimmed;
  if (/^chat(?:\/|$)/i.test(trimmed)) return `/${trimmed}`;
  return `/${trimmed}`;
};

function getNotificationKey(notification: NotificationItemProps): string {
  if (typeof notification.id === "number") {
    return `id:${notification.id}`;
  }

  return `fallback:${notification.title}|${notification.timestamp}|${String(
    notification.description,
  )}`;
}

function dedupeNotifications(
  notifications: NotificationItemProps[],
): NotificationItemProps[] {
  const seen = new Set<string>();
  const deduped: NotificationItemProps[] = [];

  for (const notification of notifications) {
    const key = getNotificationKey(notification);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(notification);
  }

  return deduped;
}

export const useNotifications = (
  options?: { isOpen?: boolean },
) => {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
  const apiBase = `${basePath}/api/notifications`;
  const [notifications, setNotifications] = useState<NotificationItemProps[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const inFlightRequests = useRef(0);

  const hasMore = useMemo(() => notifications.length < total, [notifications.length, total]);

  const beginLoading = useCallback(() => {
    inFlightRequests.current += 1;
    setLoading(true);
  }, [inFlightRequests]);

  const endLoading = useCallback(() => {
    inFlightRequests.current = Math.max(0, inFlightRequests.current - 1);
    if (inFlightRequests.current === 0) {
      setLoading(false);
    }
  }, [inFlightRequests]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/unread-count`, {
        credentials: "include",
        headers: getAuthHeader(),
        cache: "no-store",
      });
      if (!resp.ok) return;
      const payload = (await resp.json()) as {
        data?: number | { count?: number; unreadCount?: number };
        count?: number;
        unreadCount?: number;
      };
      const count =
        typeof payload.data === "number"
          ? payload.data
          : typeof payload.data === "object" && payload.data
            ? payload.data.count ?? payload.data.unreadCount
            : payload.count ?? payload.unreadCount;
      if (typeof count === "number") {
        setUnreadCount(count);
      }
    } catch {
      // ignore
    }
  }, [apiBase]);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      beginLoading();
      try {
        setError(null);
        const resp = await fetch(
          `${apiBase}?page=${pageNum}&limit=${PAGE_SIZE}`,
          {
            credentials: "include",
            headers: getAuthHeader(),
            cache: "no-store",
          },
        );
        if (!resp.ok) throw new Error(`Failed to load notifications: ${resp.status}`);
        const payload = (await resp.json()) as PaginatedResult<NotificationDto>;
        const items = Array.isArray(payload.data) ? payload.data : [];
        const mapped = dedupeNotifications(items.map((dto) => ({
          id: dto.nr_id ?? dto.n_id,
          type: mapEventType(dto.event ?? dto.n_base_event),
          title: dto.n_title,
          description: dto.n_message,
          timestamp: formatTimestamp(dto.send_at ?? dto.created_at),
          isRead: (dto.nr_status ?? dto.status) === "READ",
          onClick: (() => {
            const targetRoute = resolveNotificationRoute(dto.n_target_route, basePath);
            return targetRoute ? () => window.location.assign(targetRoute) : undefined;
          })(),
        })));

        setTotal(typeof payload.total === "number" ? payload.total : items.length);
        setPage(pageNum);
        setError(null);
        setNotifications((prev) =>
          append ? dedupeNotifications([...prev, ...mapped]) : mapped,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load notifications";
        console.error("[Notifications] Failed to fetch:", error);
        setError(message);
      } finally {
        endLoading();
      }
    },
    [apiBase, basePath, beginLoading, endLoading],
  );

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    void fetchPage(page + 1, true);
  }, [fetchPage, hasMore, loading, page]);

  const refetch = useCallback(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  const markAllRead = useCallback(async () => {
    try {
      await fetch(`${apiBase}/read-all`, {
        method: "PATCH",
        credentials: "include",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        cache: "no-store",
      });
      await fetchUnreadCount();
      void fetchPage(1, false);
    } catch (error) {
      console.error("[Notifications] Failed to mark all read:", error);
    }
  }, [apiBase, fetchPage, fetchUnreadCount]);

  useEffect(() => {
    void fetchPage(1, false);
    void fetchUnreadCount();
  }, [fetchPage, fetchUnreadCount]);

  useEffect(() => {
    if (!options?.isOpen) return;
    void fetchPage(1, false);
    void fetchUnreadCount();
  }, [fetchPage, fetchUnreadCount, options?.isOpen]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    hasMore,
    loadMore,
    refetch,
    markAllRead,
  };
};
