"use client";

import { AssistantRuntimeProvider, useThread } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { UIMessage } from "ai";
import { getAuthHeader } from "@/lib/auth/client";

// Watches for roomId in message metadata and navigates to the new room.
// Tries both msg.metadata.roomId (direct) and msg.metadata.custom.roomId
// (the @assistant-ui wrapper path). Falls back to fetching the latest room
// from the API once an assistant reply arrives.
const RoomNavigator = ({
  onNavigate,
}: {
  onNavigate: (roomId: number) => void;
}) => {
  const thread = useThread();
  const seen = React.useRef(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";

  React.useEffect(() => {
    if (seen.current) return;

    // Resolve roomId from whichever metadata path is populated
    const resolveRoomId = (): number | undefined => {
      for (const msg of thread.messages) {
        const meta = msg.metadata as
          | { roomId?: number; custom?: { roomId?: number } }
          | undefined;
        const id = meta?.roomId ?? meta?.custom?.roomId;
        if (id) return id;
      }
      return undefined;
    };

    const fromMeta = resolveRoomId();
    if (fromMeta) {
      seen.current = true;
      onNavigate(fromMeta);
      return;
    }

    // Fallback: once an assistant reply is present, fetch the latest room
    const hasAssistant = thread.messages.some((m) => m.role === "assistant");
    if (!hasAssistant) return;

    seen.current = true;
    void (async () => {
      try {
        const resp = await fetch(`${basePath}/api/chat/rooms?_t=${Date.now()}`, {
          credentials: "include",
          headers: getAuthHeader(),
        });
        if (!resp.ok) return;
        const payload = (await resp.json()) as {
          data?: Array<{ cr_id: number }>;
        };
        const latestRoom = payload.data?.[0];
        if (latestRoom) onNavigate(latestRoom.cr_id);
      } catch {
        // silent – navigation is best-effort
      }
    })();
  }, [thread.messages, onNavigate, basePath]);

  return null;
};

const HistoryRefreshBridge = ({
  roomId,
  initialMessageCount,
}: {
  roomId?: string;
  initialMessageCount: number;
}) => {
  const thread = useThread();
  // Initialize from the already-loaded history so we only fire when NEW
  // messages arrive (not when historical messages populate on mount).
  const lastLengthRef = React.useRef(initialMessageCount);
  const roomIdNum = roomId ? Number(roomId) : null;

  React.useEffect(() => {
    const currentLength = thread.messages.length;
    if (currentLength <= lastLengthRef.current) return;

    lastLengthRef.current = currentLength;

    // Immediate fire: ONLY optimistic reorder — no server fetch.
    // The server hasn't committed updated_at yet so fetching now would return
    // stale order and cause a flicker.
    window.dispatchEvent(
      new CustomEvent("chat:history-refresh", {
        detail: { roomId: roomIdNum, syncFromServer: false },
      }),
    );

    // Delayed fires: tell the sidebar to actually fetch from the server.
    // By 1 s the DB write is guaranteed to have committed.
    const sync = () =>
      window.dispatchEvent(
        new CustomEvent("chat:history-refresh", {
          detail: { roomId: roomIdNum, syncFromServer: true },
        }),
      );

    const t0 = setTimeout(sync, 200);
    const t1 = setTimeout(sync, 1000);
    const t2 = setTimeout(sync, 3000);

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [thread.messages, roomIdNum]);

  return null;
};

interface AssistantProps {
  roomId?: string;
}

export const Assistant = ({ roomId }: AssistantProps) => {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
  const [initialMessages, setInitialMessages] = React.useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = React.useState(!!roomId);

  React.useEffect(() => {
    if (!roomId) {
      setInitialMessages([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const fetchRoomMessages = async () => {
      try {
        const response = await fetch(
          `${basePath}/api/chat/rooms/${roomId}/messages`,
          {
            credentials: "include",
            headers: getAuthHeader(),
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to load room messages: ${response.status}`);
        }

        const payload = (await response.json()) as {
          data?: Array<{
            cm_id: number;
            cm_role: string;
            cm_content: string;
          }>;
        };

        const mapped: UIMessage[] = (payload.data ?? [])
          .slice()
          .reverse()
          .filter((m) => m.cm_role === "user" || m.cm_role === "assistant")
          .map((m) => ({
            id: `room-${m.cm_id}`,
            role: m.cm_role as "user" | "assistant",
            parts: [
              {
                type: "text",
                text: m.cm_content,
              },
            ],
          }));

        if (isMounted) {
          setInitialMessages(mapped);
          setIsLoading(false);
        }
      } catch (error) {
        console.error("[Assistant] Failed to load room history:", error);
        if (isMounted) {
          setInitialMessages([]);
          setIsLoading(false);
        }
      }
    };

    void fetchRoomMessages();

    return () => {
      isMounted = false;
    };
  }, [basePath, roomId]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white flex-col gap-4">
        {/* You can customize this loading state */}
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
        <div className="text-slate-500 font-medium">กำลังโหลดประวัติแชท...</div>
      </div>
    );
  }

  return (
    <AssistantInner
      roomId={roomId}
      basePath={basePath}
      initialMessages={initialMessages}
    />
  );
};

const AssistantInner = ({
  roomId,
  basePath,
  initialMessages,
}: {
  roomId?: string;
  basePath: string;
  initialMessages: UIMessage[];
}) => {
  const router = useRouter();

  const handleNewRoom = React.useCallback(
    (id: number) => {
      router.replace(`/r/${id}`);
      // Fire a refresh so the sidebar picks up the newly created room while
      // the page is navigating (pathname change will also trigger silentRefresh
      // in AppSidebar, but this fires earlier).
      window.dispatchEvent(
        new CustomEvent("chat:history-refresh", {
          detail: { roomId: id, syncFromServer: true },
        }),
      );
    },
    [router],
  );

  const runtime = useChatRuntime({
    messages: initialMessages,
    transport: new AssistantChatTransport({
      api: roomId
        ? `${basePath}/api/chat/rooms/${roomId}`
        : `${basePath}/api/chat`,
      credentials: "include",
      headers: async () => getAuthHeader(),
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {!roomId && <RoomNavigator onNavigate={handleNewRoom} />}
      <HistoryRefreshBridge roomId={roomId} initialMessageCount={initialMessages.length} />
      <div className="flex flex-col h-full bg-white relative">
        <header className="flex items-center h-[77px] px-4 shrink-0 bg-white z-10 gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 shrink-0 rounded-full w-9 h-9 p-0 transition-colors"
          >
            <Icon
              icon="ep:arrow-left-bold"
              style={{ fontSize: "24px" }}
              className="text-slate-500 hover:text-slate-700 shrink-0 transition-colors"
            />
          </Button>

          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/chat/Giga.png"
              alt="Giga"
              className="w-10 h-13 object-contain shrink-0"
            />

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/chat/GigaChatBot.png"
              alt="GiGa ChatBot"
              className="w-19 h-13 object-contain shrink-0"
            />
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};
