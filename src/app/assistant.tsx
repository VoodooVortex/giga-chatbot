"use client";

import { AssistantRuntimeProvider, useThread } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { UIMessage } from "ai";

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
        const resp = await fetch(`${basePath}/api/chat/rooms`, {
          credentials: "include",
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

const HistoryRefreshBridge = () => {
  const thread = useThread();
  const lastLengthRef = React.useRef(0);

  React.useEffect(() => {
    const currentLength = thread.messages.length;
    if (currentLength <= lastLengthRef.current) return;

    lastLengthRef.current = currentLength;

    // Fire immediately when message list grows
    window.dispatchEvent(new Event("chat:history-refresh"));

    // Fire again after 2 s — catches cases where the sidebar fetched before the
    // assistant message was fully committed to the DB (optimistic thread update).
    const t = setTimeout(() => {
      window.dispatchEvent(new Event("chat:history-refresh"));
    }, 2000);

    return () => clearTimeout(t);
  }, [thread.messages]);

  return null;
};

interface AssistantProps {
  roomId?: string;
}

export const Assistant = ({ roomId }: AssistantProps) => {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
  const [initialMessages, setInitialMessages] = React.useState<UIMessage[]>([]);

  React.useEffect(() => {
    if (!roomId) {
      setInitialMessages([]);
      return;
    }

    let isMounted = true;

    const fetchRoomMessages = async () => {
      try {
        const response = await fetch(
          `${basePath}/api/chat/rooms/${roomId}/messages`,
          {
            credentials: "include",
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
        }
      } catch (error) {
        console.error("[Assistant] Failed to load room history:", error);
        if (isMounted) {
          setInitialMessages([]);
        }
      }
    };

    void fetchRoomMessages();

    return () => {
      isMounted = false;
    };
  }, [basePath, roomId]);

  const router = useRouter();

  const handleNewRoom = React.useCallback(
    (id: number) => {
      router.replace(`/r/${id}`);
    },
    [router],
  );

  const runtime = useChatRuntime({
    messages: initialMessages,
    transport: new AssistantChatTransport({
      api: roomId
        ? `${basePath}/api/chat/rooms/${roomId}`
        : `${basePath}/api/chat`,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {!roomId && <RoomNavigator onNavigate={handleNewRoom} />}
      <HistoryRefreshBridge />
      <div className="flex flex-col h-full bg-white relative">
        <header className="flex items-center h-[77px] px-4 shrink-0 bg-white z-10 gap-2">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 shrink-0 rounded-full w-9 h-9 p-0 transition-colors"
            >
              <Icon
                icon="ep:arrow-left-bold"
                style={{ fontSize: "24px" }}
                className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 shrink-0 transition-colors"
              />
            </Button>
          </Link>

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
