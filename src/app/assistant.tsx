"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";

export const Assistant = () => {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full bg-white relative">
        <header className="flex items-center h-[77px] px-4 shrink-0 bg-white z-10 gap-2">
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 shrink-0 rounded-full w-9 h-9 p-0 transition-colors">
            <Icon icon="ep:arrow-left-bold" className="w-9 h-9" />
          </Button>

          <div className="flex items-center gap-2">

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Giga.png" alt="Giga" className="w-10 h-13 object-contain shrink-0" />

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/GigaChatBot.png" alt="GiGa ChatBot" className="w-19 h-13 object-contain shrink-0" />
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};
