"use client";

import { useCallback } from "react";
import type { NotificationItemProps } from "@/components/Notification";

/**
 * Description: Hook สำหรับจัดการ Notification
 * ใน giga-chatbot ยังไม่มี notification service → stub ที่คืนค่าว่างเสมอ
 * Author     : stub
 */
export const useNotifications = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: { onOpenNotifications?: () => void },
) => {
  const loadMore = useCallback(() => {
    // no-op
  }, []);

  return {
    notifications: [] as NotificationItemProps[],
    unreadCount: 0,
    loading: false,
    hasMore: false,
    loadMore,
    refetch: () => {},
    markAllRead: async () => {},
  };
};
