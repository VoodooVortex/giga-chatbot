"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NotificationItemProps } from "@/components/Notification";
import { getAuthHeader } from "@/lib/auth/client";

interface NotificationDto {
  n_id: number;
  n_title: string;
  n_message: string;
  n_target_route?: string | null;
  created_at: string;
  status?: "UNREAD" | "READ" | "DISMISSED";
  event?: string | null;
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

export const useNotifications = (
  _options?: { onOpenNotifications?: () => void },
) => {
  const [notifications, setNotifications] = useState<NotificationItemProps[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const hasMore = useMemo(() => notifications.length < total, [notifications.length, total]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const resp = await fetch("/api/v1/notifications/unread-count", {
        credentials: "include",
        headers: getAuthHeader(),
      });
      if (!resp.ok) return;
      const payload = (await resp.json()) as { data?: number };
      if (typeof payload.data === "number") {
        setUnreadCount(payload.data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      try {
        setLoading(true);
        const resp = await fetch(
          `/api/v1/notifications?page=${pageNum}&limit=${PAGE_SIZE}`,
          {
            credentials: "include",
            headers: getAuthHeader(),
          },
        );
        if (!resp.ok) throw new Error(`Failed to load notifications: ${resp.status}`);
        const payload = (await resp.json()) as PaginatedResult<NotificationDto>;
        const items = Array.isArray(payload.data) ? payload.data : [];
        const mapped = items.map((dto) => ({
          id: dto.nr_id ?? dto.n_id,
          type: mapEventType(dto.event),
          title: dto.n_title,
          description: dto.n_message,
          timestamp: formatTimestamp(dto.created_at),
          isRead: dto.status === "READ",
          onClick: dto.n_target_route
            ? () => window.location.assign(dto.n_target_route as string)
            : undefined,
        }));

        setTotal(typeof payload.total === "number" ? payload.total : items.length);
        setPage(pageNum);
        setNotifications((prev) => (append ? [...prev, ...mapped] : mapped));
      } catch (error) {
        console.error("[Notifications] Failed to fetch:", error);
        if (!append) setNotifications([]);
      } finally {
        setLoading(false);
      }
    },
    [],
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
      await fetch("/api/v1/notifications/read-all", {
        method: "PATCH",
        credentials: "include",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
      });
      await fetchUnreadCount();
      void fetchPage(1, false);
    } catch (error) {
      console.error("[Notifications] Failed to mark all read:", error);
    }
  }, [fetchPage, fetchUnreadCount]);

  useEffect(() => {
    void fetchPage(1, false);
    void fetchUnreadCount();
  }, [fetchPage, fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadMore,
    refetch,
    markAllRead,
  };
};
