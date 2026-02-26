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

  const fetchRooms = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${basePath}/api/chat/rooms`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to load rooms: ${response.status}`);
      }

      const payload = (await response.json()) as { data?: ChatRoomItem[] };
      setRooms(payload.data ?? []);
    } catch (error) {
      console.error("[AppSidebar] Failed to fetch chat rooms:", error);
      setRooms([]);
    } finally {
      setIsLoading(false);
    }
  }, [basePath]);

  const pathname = usePathname();
  // Allow "แชทใหม่" only when the current room already has messages.
  // Empty rooms are filtered out of the `rooms` list by the API, so if the
  // current roomId isn't present in the list the room is still empty.
  const currentRoomId = React.useMemo(() => {
    const match = pathname.match(/^\/r\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [pathname]);
  const isInRoom =
    currentRoomId !== null && rooms.some((r) => r.cr_id === currentRoomId);

  React.useEffect(() => {
    void fetchRooms();
  }, [fetchRooms, pathname]);

  React.useEffect(() => {
    const handler = () => {
      void fetchRooms();
    };

    window.addEventListener("chat:history-refresh", handler);
    return () => {
      window.removeEventListener("chat:history-refresh", handler);
    };
  }, [fetchRooms]);

  const handleCreateRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`${basePath}/api/chat/rooms`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: null }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create room: ${response.status}`);
      }

      const payload = (await response.json()) as { data?: { cr_id: number } };
      const newRoomId = payload.data?.cr_id;

      if (newRoomId) {
        // push then refresh ensures the app-router fully re-renders
        // with the new roomId even when already on a /r/* page
        router.push(`/r/${newRoomId}`);
        router.refresh();
        return;
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
              {isLoading && (
                <div className="w-[297px] h-[54px] px-4 flex items-center text-sm text-slate-400">
                  กำลังโหลดประวัติแชท...
                </div>
              )}

              {!isLoading && rooms.length === 0 && (
                <div className="w-[297px] h-[54px] px-4 flex items-center text-sm text-slate-400">
                  ยังไม่มีประวัติแชท
                </div>
              )}

              {rooms.map((room) => (
                <SidebarMenuItem key={room.cr_id} className="w-[297px]">
                  <SidebarMenuButton
                    asChild
                    className="w-[297px] h-[54px] flex gap-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 whitespace-normal text-sm items-center rounded-xl px-4"
                  >
                    <Link href={`/r/${room.cr_id}`}>
                      <Icon
                        icon="mdi:folder-open-outline"
                        style={{ fontSize: "24px" }}
                        className="shrink-0 text-slate-800 hover:bg-slate-100 transition-colors"
                      />
                      <span className="line-clamp-2 leading-snug">
                        {room.preview_title || room.cr_title || "บทสนทนา"}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
