import * as React from "react";
import {
  AiBrain01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowReloadHorizontalIcon,
  Copy01Icon,
  Edit01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { MarkdownContent } from "@/components/chat/markdown-content";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useScrollFollow } from "@/hooks/use-scroll-follow";
import { cn } from "@/lib/utils";

const numberFormatter = new Intl.NumberFormat();

function isPresent(value) {
  return value !== null && value !== undefined;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }

  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 2 : 1)} s`;
}

function formatThoughtDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) {
    return null;
  }

  return `${Math.max(0, Math.floor(milliseconds / 1000))}s`;
}

function humanize(value) {
  const text = String(value ?? "")
    .replaceAll(/[-_]+/g, " ")
    .trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function metricParts(metrics) {
  if (!metrics) {
    return [];
  }

  const parts = [];
  const duration = formatDuration(metrics.durationMs);
  const ttft = formatDuration(metrics.ttftMs);

  if (duration) {
    parts.push(duration);
  }
  if (ttft) {
    parts.push(`${ttft} TTFT`);
  }
  if (Number.isFinite(metrics.tokensPerSecond)) {
    parts.push(`${metrics.tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (isPresent(metrics.usage?.completionTokens)) {
    parts.push(`${numberFormatter.format(metrics.usage.completionTokens)} out`);
  }
  if (isPresent(metrics.usage?.promptTokens)) {
    parts.push(`${numberFormatter.format(metrics.usage.promptTokens)} in`);
  }
  if (metrics.finishReason && metrics.finishReason !== "stop") {
    parts.push(humanize(metrics.finishReason));
  }

  return parts;
}

function MessageEditor({
  disabled,
  draft,
  message,
  onCancel,
  onChange,
  onSave,
}) {
  const isUser = message.role === "user";
  const valid = Boolean(draft.trim() || (isUser && message.image));

  const save = () => {
    if (valid) {
      onSave();
    }
  };

  return (
    <form
      className="w-full space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Textarea
        autoFocus
        aria-label={isUser ? "Edit prompt" : "Edit response"}
        className={cn(
          "max-h-72 min-h-24 bg-background text-base md:text-body-md",
          isUser && "border-border/70",
        )}
        disabled={disabled}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }

          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          disabled={disabled}
          size="sm"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={disabled || !valid} size="sm">
          {disabled ? "Saving…" : isUser ? "Save & regenerate" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function ThinkingDisclosure({ message }) {
  const [open, setOpen] = React.useState(false);
  const [liveElapsed, setLiveElapsed] = React.useState(0);
  const openedForReasoningRef = React.useRef(false);
  const collapsedForAnswerRef = React.useRef(Boolean(message.text));
  const thinkingLive = message.status === "streaming" && !message.text;
  const thinkingScroll = useScrollFollow({
    content: message.reasoning,
    enabled: open && thinkingLive,
  });

  React.useEffect(() => {
    if (message.reasoning && thinkingLive && !openedForReasoningRef.current) {
      openedForReasoningRef.current = true;
      setOpen(true);
    }
  }, [message.reasoning, thinkingLive]);

  React.useEffect(() => {
    if (message.text && !collapsedForAnswerRef.current) {
      collapsedForAnswerRef.current = true;
      setOpen(false);
    }
  }, [message.text]);

  React.useEffect(() => {
    if (!thinkingLive || !message.reasoningStartedAt) {
      return undefined;
    }

    const updateElapsed = () => {
      setLiveElapsed(
        Math.max(0, globalThis.performance.now() - message.reasoningStartedAt),
      );
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 250);
    return () => clearInterval(timer);
  }, [message.reasoningStartedAt, thinkingLive]);

  if (!message.reasoning) {
    return null;
  }

  const duration = formatThoughtDuration(
    thinkingLive ? liveElapsed : message.reasoningDurationMs,
  );
  const label = thinkingLive
    ? `Thinking${duration ? ` · ${duration}` : "…"}`
    : duration
      ? `Thought for ${duration}`
      : "Thinking";

  return (
    <Collapsible className="mb-3" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          className="-ml-2 text-muted-foreground"
          size="sm"
          variant="ghost"
        >
          <span className="type-numeric">{label}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={thinkingScroll.scrollRef}
          aria-label="Model thinking"
          className="scrollbar-thin mt-1 max-h-44 overflow-y-auto border-l pl-3 text-body-md text-muted-foreground"
          role="region"
          tabIndex={0}
          onKeyDown={thinkingScroll.onKeyDown}
          onScroll={thinkingScroll.onScroll}
          onTouchEnd={thinkingScroll.onTouchEnd}
          onTouchMove={thinkingScroll.onTouchMove}
          onTouchStart={thinkingScroll.onTouchStart}
          onWheel={thinkingScroll.onWheel}
        >
          <MarkdownContent>{message.reasoning}</MarkdownContent>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageActions({ disabled, message, onCopy, onEdit, onRegenerate }) {
  const [copied, setCopied] = React.useState(false);
  const copiedTimerRef = React.useRef(null);

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const copy = async () => {
    if (!(await onCopy(message))) {
      return;
    }

    setCopied(true);
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/message:opacity-100 sm:group-hover/message:opacity-100">
      {message.text ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label={
                copied
                  ? "Copied"
                  : `Copy ${message.role === "user" ? "prompt" : "response"}`
              }
              size="icon-xs"
              variant="ghost"
              onClick={() => void copy()}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              type="button"
              aria-label={`Edit ${message.role === "user" ? "prompt" : "response"}`}
              disabled={disabled}
              size="icon-xs"
              variant="ghost"
              onClick={() => onEdit(message)}
            >
              <HugeiconsIcon icon={Edit01Icon} strokeWidth={2} />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      {onRegenerate ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              aria-label="Regenerate response"
              disabled={disabled}
              size="icon-xs"
              variant="ghost"
              onClick={onRegenerate}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Regenerate</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function ChatMessage({
  actionsDisabled,
  canRegenerate,
  editDraft,
  editPending,
  editing,
  message,
  onCancelEdit,
  onCopy,
  onEdit,
  onEditDraftChange,
  onRegenerate,
  onSaveEdit,
}) {
  if (message.role === "user") {
    return (
      <article
        className="group/message flex justify-end scroll-mt-4"
        aria-label="You"
      >
        <div className="flex w-full max-w-[88%] flex-col items-end sm:max-w-[82%]">
          <div
            className={cn(
              "w-fit max-w-full space-y-2 rounded-2xl bg-muted px-3.5 py-2.5",
              editing && "w-full",
            )}
          >
            {message.image ? (
              <img
                src={message.image.dataUrl}
                alt={message.image.name || "Attached image"}
                className="max-h-72 w-auto max-w-full rounded-xl object-contain"
              />
            ) : null}
            {editing ? (
              <MessageEditor
                disabled={editPending}
                draft={editDraft}
                message={message}
                onCancel={onCancelEdit}
                onChange={onEditDraftChange}
                onSave={onSaveEdit}
              />
            ) : message.text ? (
              <p className="whitespace-pre-wrap wrap-break-word">
                {message.text}
              </p>
            ) : null}
          </div>

          {!editing ? (
            <footer className="mt-1 flex min-h-7 items-center justify-end gap-1 text-label-sm text-muted-foreground">
              {message.edited ? <span>Edited</span> : null}
              <MessageActions
                disabled={actionsDisabled}
                message={message}
                onCopy={onCopy}
                onEdit={onEdit}
              />
            </footer>
          ) : null}
        </div>
      </article>
    );
  }

  const parts = metricParts(message.metrics);
  const thinkingTokens = message.metrics?.thinkingTokens;

  return (
    <article
      className="group/message min-w-0 scroll-mt-4"
      aria-label="Muse Glimmer"
    >
      <div className="min-w-0 text-body-lg">
        {editing ? (
          <MessageEditor
            disabled={editPending}
            draft={editDraft}
            message={message}
            onCancel={onCancelEdit}
            onChange={onEditDraftChange}
            onSave={onSaveEdit}
          />
        ) : (
          <>
            <ThinkingDisclosure message={message} />
            {message.text ? (
              <MarkdownContent>{message.text}</MarkdownContent>
            ) : null}
            {message.status === "streaming" &&
            !message.text &&
            !message.reasoning ? (
              <div
                role="status"
                className="flex items-center gap-2 text-body-md text-muted-foreground"
              >
                <HugeiconsIcon
                  icon={Loading03Icon}
                  strokeWidth={2}
                  className="size-4 animate-spin"
                />
                Generating
              </div>
            ) : null}
            {message.error ? (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 text-body-sm text-destructive"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>{message.error}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {!editing && message.status !== "streaming" ? (
        <footer className="mt-2 flex flex-col items-start gap-1 text-label-sm text-muted-foreground">
          {message.edited || parts.length > 0 || isPresent(thinkingTokens) ? (
            <div className="flex min-w-0 items-center gap-1">
              {message.edited ? <span>Edited</span> : null}
              {parts.length > 0 || isPresent(thinkingTokens) ? (
                <span className="type-numeric truncate font-mono">
                  {parts.join(" · ")}
                  {isPresent(thinkingTokens) ? (
                    <>
                      {parts.length > 0 ? " · " : null}
                      <span className="sr-only">Thinking tokens: </span>
                      <HugeiconsIcon
                        aria-hidden="true"
                        className="mr-1 inline-block size-3.5 align-[-0.125em]"
                        icon={AiBrain01Icon}
                        strokeWidth={2}
                      />
                      {numberFormatter.format(thinkingTokens)}
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}
          <MessageActions
            disabled={actionsDisabled}
            message={message}
            onCopy={onCopy}
            onEdit={onEdit}
            onRegenerate={canRegenerate ? onRegenerate : null}
          />
        </footer>
      ) : null}
    </article>
  );
}
