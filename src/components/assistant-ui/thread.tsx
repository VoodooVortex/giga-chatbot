import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { Icon } from "@iconify/react";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import type { FC } from "react";

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(186,220,255,0.50) 0%, rgba(214,234,255,0.25) 45%, rgba(255,255,255,0) 80%)",
        }}
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            EditComposer,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full flex-col gap-0 overflow-visible rounded-t-3xl pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4 items-center gap-4">
          {/* Giga mascot with soft radial glow */}
          <div className="relative flex items-center justify-center mb-2">
            <div
              className="absolute rounded-full"
              style={{
                width: "280px",
                height: "280px",
                background:
                  "radial-gradient(ellipse at center, rgba(186,220,255,0.7) 0%, rgba(186,220,255,0) 65%)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/chat/Giga.png"
              alt="Giga"
              className="relative w-26 h-30 object-contain z-10"
            />
          </div>

          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-center text-[32px] md:text-[38px] tracking-tight duration-200 leading-snug">
            <span className="font-medium text-[#40A9FF]">How can </span>
            <span className="font-bold text-[#40A9FF]">Giga</span>
            <span className="font-medium text-[#40A9FF]">
              {" "}
              help you
              <br />
              today ?
            </span>
          </h1>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  const suggestions = [
    { text: "ตรวจสอบอุปกรณ์ที่ว่างใช้งาน" },
    { text: "ต้องการแจ้งปัญหาอุปกรณ์" },
    { text: "อยากทราบรายละเอียดของอุปกรณ์" },
  ];

  return (
    <div className="aui-thread-welcome-suggestions flex flex-row gap-2.5 justify-center items-center pb-8">
      {suggestions.map((s, i) => (
        <ThreadPrimitive.Suggestion
          key={i}
          prompt={s.text}
          method="replace"
          autoSend
          className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200 h-[54px] w-[330px] bg-[#3A4354] hover:bg-[#2C3342] text-white hover:text-gray-100 rounded-full border-none px-6 font-medium text-[15px] transition-colors flex items-center justify-center cursor-pointer shrink-0"
        >
          <span className="text-center">{s.text}</span>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col max-w-[1166px] mx-auto px-6 mb-6">
      {/* Attachment previews appear above the pill when files are added */}
      <ComposerAttachments />

      {/* Input pill */}
      <ComposerPrimitive.AttachmentDropzone className="aui-composer-attachment-dropzone flex flex-row items-center w-full h-[64px] rounded-full bg-[#F2F2F2] p-[8px] outline-none transition-shadow focus-within:ring-2 focus-within:ring-[#4BA6F5]/20 focus-within:bg-[#F8F8F8] shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
        {/* Left: dark circle — 48×48 */}
        <div className="flex items-center shrink-0">
          <div className="w-[48px] h-[48px] rounded-full bg-[#3A4354] hover:bg-[#2C3342] flex items-center justify-center transition-colors">
            <ComposerAddAttachment />
          </div>
        </div>

        {/* Center: text input */}
        <ComposerPrimitive.Input
          placeholder="พิมพ์ข้อความของคุณที่นี่..."
          className="aui-composer-input h-full w-full resize-none bg-transparent px-5 text-[15px] outline-none placeholder:text-gray-400 focus-visible:ring-0 leading-relaxed"
          rows={1}
          autoFocus
          aria-label="Message input"
        />

        {/* Right: blue circle send — 48×48 */}
        <div className="flex items-center shrink-0">
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="flex flex-col items-center justify-center">
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <Button
            type="submit"
            variant="default"
            size="icon"
            className="w-[48px] h-[48px] rounded-full bg-[#4BA6F5] hover:bg-[#3B96F3] text-white shadow-sm flex items-center justify-center transition-transform hover:scale-105"
            aria-label="Send message"
          >
            <Icon
              icon="heroicons-outline:arrow-up"
              className="w-7 h-7 stroke-[2.5]"
            />
          </Button>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="w-[48px] h-[48px] rounded-full bg-slate-800 hover:bg-slate-700 text-white shadow-sm flex items-center justify-center transition-transform hover:scale-105"
            aria-label="Stop generating"
          >
            <SquareIcon className="size-4 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      {/* Avatar + Bubble row */}
      <div className="flex items-start gap-3 px-2">
        {/* Giga avatar */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/chat/Giga.png"
          alt="Giga"
          className="w-10 h-10 object-contain shrink-0 mt-0.5"
        />

        {/* Message bubble */}
        <div className="aui-assistant-message-content wrap-break-word bg-[#3A4354] text-white rounded-2xl rounded-tl-sm px-4 py-3 leading-relaxed text-[15px] max-w-[85%]">
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              tools: { Fallback: ToolFallback },
            }}
          />
          <MessageError />
        </div>
      </div>

      {/* Action bar below bubble (offset to align under bubble) */}
      <div className="aui-assistant-message-footer mt-1 ml-[52px] flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word rounded-2xl rounded-tr-sm bg-[#4BA6F5] px-4 py-2.5 text-white text-[15px]">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
