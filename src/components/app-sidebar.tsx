"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface ChatRoomItem {
  cr_id: number;
  cr_title: string | null;
  preview_title?: string | null;
  created_at: string;
  updated_at: string | null;
}

export function AppSidebar() {
  const router = useRouter();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
  const [rooms, setRooms] = React.useState<ChatRoomItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Full fetch with loading spinner — used only on initial mount.
  const fetchRooms = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${basePath}/api/chat/rooms?_t=${Date.now()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Failed to load rooms: ${response.status}`);
      const payload = (await response.json()) as { data?: ChatRoomItem[] };
      setRooms(payload.data ?? []);
    } catch (error) {
      console.error("[AppSidebar] Failed to fetch chat rooms:", error);
      setRooms([]);
    } finally {
      setIsLoading(false);
    }
  }, [basePath]);

  // Silent background refresh — no loading spinner, no flicker.
  const silentRefresh = React.useCallback(async () => {
    try {
      const response = await fetch(`${basePath}/api/chat/rooms?_t=${Date.now()}`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: ChatRoomItem[] };
      setRooms(payload.data ?? []);
    } catch {
      // best-effort
    }
  }, [basePath]);

  const pathname = usePathname();

  const currentRoomId = React.useMemo(() => {
    const match = pathname.match(/^\/r\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [pathname]);

  // Allow "แชทใหม่" only when the current room already has messages.
  const isInRoom =
    currentRoomId !== null && rooms.some((r) => r.cr_id === currentRoomId);

  // Initial load with spinner.
  React.useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  // Re-fetch silently on every navigation (catches new-chat room creation and
  // any ordering updates that happened while the user was in a different room).
  const prevPathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    if (pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = pathname;
    void silentRefresh();
  }, [pathname, silentRefresh]);

  // Listen for chat:history-refresh events dispatched by HistoryRefreshBridge.
  // The event may carry a detail.roomId so we can immediately move that room to
  // the top of the list (optimistic update) before the background fetch lands.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ roomId?: number | null }>).detail;
      const roomId = detail?.roomId;

      if (roomId) {
        // Optimistically move the room to the top so the UI reacts instantly.
        setRooms((prev) => {
          const idx = prev.findIndex((r) => r.cr_id === roomId);
          if (idx <= 0) return prev; // already at top or not found yet
          const room = prev[idx]!;
          return [room, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
        });
      }

      // Always do a background fetch to get the true server state.
      void silentRefresh();
    };

    window.addEventListener("chat:history-refresh", handler);
    return () => {
      window.removeEventListener("chat:history-refresh", handler);
    };
  }, [silentRefresh]);

  const handleCreateRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`${basePath}/api/chat/rooms?_t=${Date.now()}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: null }),
      });

      if (!response.ok) throw new Error(`Failed to create room: ${response.status}`);

      const payload = (await response.json()) as { data?: { cr_id: number } };
      const newRoomId = payload.data?.cr_id;

      if (newRoomId) {
        router.push(`/r/${newRoomId}`);
        router.refresh();
      }
    } catch (error) {
      console.error("[AppSidebar] Failed to create chat room:", error);
    }
  }, [basePath, router]);

  return (
    <Sidebar
      side="right"
      variant="sidebar"
      className="border-l bg-white w-[360px] h-full"
    >
      <SidebarHeader className="py-2">
        <div className="flex justify-center">
          <button
            onClick={() => isInRoom && void handleCreateRoom()}
            disabled={!isInRoom}
            className={[
              "w-[297px] h-[54px] text-base flex gap-3 items-center rounded-xl px-4 transition-colors",
              isInRoom
                ? "text-slate-800 hover:bg-slate-100 cursor-pointer"
                : "text-slate-300 cursor-default",
            ].join(" ")}
          >
            <Icon
              icon="lucide:edit"
              style={{ fontSize: "24px" }}
              className="shrink-0 transition-colors"
            />
            <span>แชทใหม่</span>
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-medium text-slate-400 pl-[47px] py-2">
            แชท
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-0 flex flex-col items-center gap-1">
              {isLoading && rooms.length === 0 && (
                <div className="w-[297px] h-[54px] px-4 flex items-center text-sm text-slate-400">
                  กำลังโหลดประวัติแชท...
                </div>
              )}

              {!isLoading && rooms.length === 0 && (
                <div className="w-[297px] h-[54px] px-4 flex items-center text-sm text-slate-400">
                  ยังไม่มีประวัติแชท
                </div>
              )}

              {rooms.map((room) => {
                const isActive = room.cr_id === currentRoomId;
                return (
                  <SidebarMenuItem key={room.cr_id} className="w-[297px]">
                    <SidebarMenuButton
                      asChild
                      className={[
                        "w-[297px] h-[54px] flex gap-3 whitespace-normal text-sm items-center rounded-xl px-4 transition-colors",
                        isActive
                          ? "bg-slate-100 text-slate-900 font-medium"
                          : "text-slate-700 hover:text-slate-900 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      <Link href={`/r/${room.cr_id}`}>
                        <Icon
                          icon={isActive ? "mdi:folder-open" : "mdi:folder-open-outline"}
                          style={{ fontSize: "24px" }}
                          className={[
                            "shrink-0 transition-colors",
                            isActive ? "text-blue-500" : "text-slate-800",
                          ].join(" ")}
                        />
                        <span className="line-clamp-2 leading-snug">
                          {room.preview_title || room.cr_title || "บทสนทนา"}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
