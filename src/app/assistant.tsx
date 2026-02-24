"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface AssistantProps {
  roomId?: string;
}

export const Assistant = ({ roomId }: AssistantProps) => {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: roomId ? `/api/chat/rooms/${roomId}` : "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full bg-white relative">
        <header className="flex items-center h-[77px] px-4 shrink-0 bg-white z-10 gap-2">
          <Link href="/chat">
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

          {roomId && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-slate-500">Room: {roomId}</span>
            </div>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};
