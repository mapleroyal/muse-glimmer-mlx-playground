import * as React from "react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  Image02Icon,
  Loading03Icon,
  SentIcon,
  Settings02Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { ChatMessage } from "@/components/chat/chat-message";
import { PlaygroundSettings } from "@/components/chat/playground-settings";
import { ThemeModeSwitcher } from "@/components/theme/theme-mode-switcher";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cancelGeneration,
  createSessionId,
  DEFAULT_GENERATION_SETTINGS,
  deleteSession,
  getHealth,
  getProjectSessionId,
  getRuntime,
  persistProjectSessionId,
  REASONING_STRENGTHS,
  resetSession,
  streamChatCompletion,
  toOpenAiMessages,
} from "@/lib/chat-api";
import { APP_DESCRIPTION, formatPageTitle } from "@/lib/app-config";
import { applyMessageEdit } from "@/lib/chat-history";
import { useScrollFollow } from "@/hooks/use-scroll-follow";

const POLL_INTERVAL_MS = 2500;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const BLOCKED_RUNTIME_TERMS = [
  "starting",
  "preparing",
  "download",
  "convert",
  "loading",
  "initializ",
  "error",
  "failed",
  "offline",
  "unavailable",
  "generating",
];
const numberFormatter = new Intl.NumberFormat();

export function meta() {
  return [
    { title: formatPageTitle() },
    { name: "description", content: APP_DESCRIPTION },
  ];
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isPresent(value) {
  return value !== null && value !== undefined;
}

function settingsFromRuntime(runtime) {
  const defaults = runtime?.defaults ?? {};
  const reasoningStrength = String(
    defaults.reasoningStrength ?? DEFAULT_GENERATION_SETTINGS.reasoningStrength,
  ).toLowerCase();

  return {
    temperature: finiteNumber(
      defaults.temperature,
      DEFAULT_GENERATION_SETTINGS.temperature,
    ),
    topP: finiteNumber(defaults.topP, DEFAULT_GENERATION_SETTINGS.topP),
    topK: finiteNumber(defaults.topK, DEFAULT_GENERATION_SETTINGS.topK),
    maxTokens: finiteNumber(
      defaults.maxTokens,
      DEFAULT_GENERATION_SETTINGS.maxTokens,
    ),
    reasoningStrength: REASONING_STRENGTHS.includes(reasoningStrength)
      ? reasoningStrength
      : DEFAULT_GENERATION_SETTINGS.reasoningStrength,
  };
}

function humanizeState(value) {
  if (!value) {
    return "Starting";
  }

  const text = String(value).replaceAll(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "Starting";
}

function runtimePresentation({
  connection,
  runtime,
  sessionError,
  sessionTransitioning,
  stopRequested,
  streaming,
}) {
  if (sessionTransitioning) {
    return { busy: true, label: "Resetting", tone: "muted" };
  }

  if (sessionError) {
    return { busy: false, label: "Session error", tone: "error" };
  }

  if (stopRequested) {
    return { busy: true, label: "Stopping", tone: "muted" };
  }

  if (streaming) {
    return { busy: true, label: "Generating", tone: "active" };
  }

  if (connection.status === "connecting") {
    return { busy: true, label: "Connecting", tone: "muted" };
  }

  if (connection.status === "offline") {
    return { busy: false, label: "Offline", tone: "error" };
  }

  const rawState = String(runtime?.state ?? "starting").toLowerCase();
  const blocked = BLOCKED_RUNTIME_TERMS.some((term) => rawState.includes(term));

  if (blocked) {
    return {
      busy: !rawState.includes("error") && !rawState.includes("failed"),
      label: humanizeState(rawState),
      tone:
        rawState.includes("error") || rawState.includes("failed")
          ? "error"
          : "muted",
    };
  }

  return { busy: false, label: humanizeState(rawState), tone: "ready" };
}

function isRuntimeReady(connection, runtime) {
  if (connection.status !== "online" || !runtime) {
    return false;
  }

  const state = String(runtime.state ?? "").toLowerCase();
  return !BLOCKED_RUNTIME_TERMS.some((term) => state.includes(term));
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function responseMetrics({
  endedAt,
  finishReason,
  firstTokenAt,
  runtimeMetrics,
  startedAt,
  usage,
}) {
  const completionTokens = usage?.completionTokens ?? null;
  const elapsedSeconds = Math.max((endedAt - startedAt) / 1000, 0.001);
  const tokensPerSecond =
    runtimeMetrics?.decodeTokensPerSecond ??
    (isPresent(completionTokens) ? completionTokens / elapsedSeconds : null);
  const modelTtft = isPresent(runtimeMetrics?.prefillMs)
    ? runtimeMetrics.prefillMs + (runtimeMetrics.visionEncoderMs ?? 0)
    : null;

  return {
    durationMs: endedAt - startedAt,
    finishReason,
    tokensPerSecond:
      completionTokens > 0 && tokensPerSecond > 0 ? tokensPerSecond : null,
    thinkingTokens: runtimeMetrics?.thinkingTokens ?? null,
    ttftMs: modelTtft ?? (firstTokenAt ? firstTokenAt - startedAt : null),
    usage,
  };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.addEventListener("load", () => resolve(reader.result), {
      once: true,
    });
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Unable to read image.")),
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

function newMessageId(role) {
  return `${role}-${createSessionId()}`;
}

function latestAssistantMetrics(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant" && messages[index].metrics) {
      return messages[index].metrics;
    }
  }
  return null;
}

function EmptyTranscript({ connection, onRetry, runtime, runtimeView }) {
  const waiting = runtimeView.busy || connection.status !== "online";

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <h2 className="text-headline-lg">Muse Glimmer</h2>
      <p className="mt-2 text-body-md text-muted-foreground">
        {waiting
          ? `${runtimeView.label} local runtime…`
          : runtime?.supports?.vision
            ? "Ask anything, or attach an image."
            : "Ready on this Mac."}
      </p>
      {connection.status === "offline" ? (
        <Button
          type="button"
          className="mt-4"
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

function ChatTranscript({
  actionsDisabled,
  autoFollowRef,
  connection,
  editDraft,
  editPending,
  editingMessageId,
  messages,
  onCancelEdit,
  onCopy,
  onEdit,
  onEditDraftChange,
  onRegenerate,
  onRetryConnection,
  onSaveEdit,
  runtime,
  runtimeView,
  setShowScrollButton,
  showScrollButton,
  streaming,
  transcriptRef,
}) {
  const transcriptScroll = useScrollFollow({
    content: messages,
    followRef: autoFollowRef,
    onFollowChange: (following) => setShowScrollButton(!following),
    scrollRef: transcriptRef,
  });

  const scrollToBottom = () => {
    transcriptScroll.scrollToBottom({ behavior: "smooth" });
  };

  const lastAssistantIndex = messages.findLastIndex(
    (message) => message.role === "assistant",
  );

  return (
    <section className="relative min-h-0 flex-1">
      <div
        ref={transcriptRef}
        role="log"
        aria-label="Conversation"
        aria-busy={streaming}
        aria-relevant="additions"
        className="scrollbar-thin size-full overflow-y-auto overscroll-contain"
        tabIndex={0}
        onKeyDown={transcriptScroll.onKeyDown}
        onScroll={transcriptScroll.onScroll}
        onTouchEnd={transcriptScroll.onTouchEnd}
        onTouchMove={transcriptScroll.onTouchMove}
        onTouchStart={transcriptScroll.onTouchStart}
        onWheel={transcriptScroll.onWheel}
      >
        {messages.length === 0 ? (
          <EmptyTranscript
            connection={connection}
            onRetry={onRetryConnection}
            runtime={runtime}
            runtimeView={runtimeView}
          />
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                actionsDisabled={actionsDisabled}
                message={message}
                editDraft={editDraft}
                editPending={editPending}
                editing={editingMessageId === message.id}
                canRegenerate={
                  index === lastAssistantIndex &&
                  message.status !== "streaming" &&
                  !actionsDisabled
                }
                onCancelEdit={onCancelEdit}
                onCopy={onCopy}
                onEdit={onEdit}
                onEditDraftChange={onEditDraftChange}
                onRegenerate={onRegenerate}
                onSaveEdit={onSaveEdit}
              />
            ))}
          </div>
        )}
      </div>

      {showScrollButton ? (
        <Button
          type="button"
          aria-label="Scroll to latest message"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 border-border bg-background shadow-sm"
          size="icon-sm"
          variant="outline"
          onClick={scrollToBottom}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
        </Button>
      ) : null}
    </section>
  );
}

function ChatComposer({
  attachment,
  canGenerate,
  conversationHasImage,
  draft,
  editing,
  fileInputRef,
  onAttachmentChange,
  onDraftChange,
  onFileChange,
  onStop,
  onSubmit,
  runtime,
  runtimeView,
  stopRequested,
  streaming,
}) {
  const messageInputRef = React.useRef(null);
  const visionAvailable = Boolean(runtime?.supports?.vision);
  const attachmentDisabled =
    editing ||
    streaming ||
    !visionAvailable ||
    conversationHasImage ||
    Boolean(attachment);
  const hasContent = Boolean(draft.trim() || attachment);
  const attachHint = !visionAvailable
    ? "Vision is unavailable"
    : conversationHasImage
      ? "This conversation already has an image"
      : attachment
        ? "Remove the current image to choose another"
        : "Attach PNG or JPEG";

  React.useEffect(() => {
    if (streaming && !editing) {
      messageInputRef.current?.focus({ preventScroll: true });
    }
  }, [editing, streaming]);

  return (
    <form
      className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!streaming && canGenerate && hasContent) {
          onSubmit();
        }
      }}
    >
      <InputGroup className="overflow-hidden rounded-2xl border-border bg-background shadow-[0_8px_30px_rgb(0_0_0/0.07)] dark:shadow-[0_8px_30px_rgb(0_0_0/0.24)]">
        {attachment ? (
          <InputGroupAddon
            align="block-start"
            className="w-full justify-start border-b border-border/60 px-3 py-2.5"
          >
            <img
              src={attachment.dataUrl}
              alt="Selected attachment preview"
              className="size-12 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-label-md text-foreground">
                {attachment.name}
              </p>
              <p className="text-body-sm font-normal text-muted-foreground">
                {formatFileSize(attachment.size)}
              </p>
            </div>
            <InputGroupButton
              aria-label="Remove image"
              size="icon-xs"
              onClick={() => onAttachmentChange(null)}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}

        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <InputGroupTextarea
          ref={messageInputRef}
          id="chat-message"
          autoFocus
          className="max-h-44 min-h-12 overflow-y-auto px-3.5 py-3 text-base md:text-body-md"
          disabled={!canGenerate}
          placeholder={
            editing
              ? "Finish editing the message"
              : canGenerate
                ? "Message Muse Glimmer"
                : runtimeView.label === "Offline"
                  ? "Local runtime is offline"
                  : `${runtimeView.label}…`
          }
          rows={1}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!streaming && canGenerate && hasContent) {
                onSubmit();
              }
            }
          }}
        />

        <InputGroupAddon
          align="block-end"
          className="w-full justify-between px-2.5 pb-2.5"
        >
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onFileChange(file);
                }
                event.target.value = "";
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <InputGroupButton
                    type="button"
                    aria-label="Attach image"
                    disabled={attachmentDisabled}
                    size="icon-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <HugeiconsIcon icon={Image02Icon} strokeWidth={2} />
                  </InputGroupButton>
                </span>
              </TooltipTrigger>
              <TooltipContent>{attachHint}</TooltipContent>
            </Tooltip>
          </div>

          {streaming ? (
            <Button
              type="button"
              aria-label={
                stopRequested ? "Stopping generation" : "Stop generating"
              }
              className="rounded-full"
              disabled={stopRequested}
              size="icon-sm"
              onClick={onStop}
            >
              <HugeiconsIcon
                icon={stopRequested ? Loading03Icon : StopIcon}
                strokeWidth={2.5}
                className={stopRequested ? "animate-spin" : undefined}
              />
            </Button>
          ) : (
            <Button
              type="submit"
              aria-label="Send message"
              className="rounded-full"
              disabled={!canGenerate || !hasContent}
              size="icon-sm"
            >
              <HugeiconsIcon icon={SentIcon} strokeWidth={2.5} />
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function RuntimeStatus({ messages, runtime, runtimeView, streaming }) {
  const metrics = latestAssistantMetrics(messages);
  const totalTokens = metrics?.usage?.totalTokens;
  const contextLength = Number(runtime?.contextLength) || null;

  return (
    <footer className="runtime-status flex shrink-0 items-center gap-3 border-t px-3 font-mono text-label-sm text-muted-foreground sm:px-4">
      <div className="flex min-w-0 items-center gap-2" aria-live="polite">
        <span
          aria-hidden="true"
          data-corner-shape="round"
          data-tone={runtimeView.tone}
          className="runtime-dot"
        />
        <span className="truncate">{runtimeView.label}</span>
        {runtime?.backend ? (
          <span className="hidden truncate sm:inline">· {runtime.backend}</span>
        ) : null}
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {isPresent(totalTokens) && contextLength ? (
          <span className="hidden min-[420px]:inline">
            {numberFormatter.format(totalTokens)} /{" "}
            {numberFormatter.format(contextLength)} ctx
          </span>
        ) : null}
        {!streaming && Number.isFinite(metrics?.tokensPerSecond) ? (
          <span>{metrics.tokensPerSecond.toFixed(1)} tok/s</span>
        ) : null}
      </span>
    </footer>
  );
}

export default function HomeRoute() {
  const [attachment, setAttachment] = React.useState(null);
  const [connection, setConnection] = React.useState({
    error: null,
    status: "connecting",
  });
  const [draft, setDraft] = React.useState("");
  const [editor, setEditor] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [pollRevision, setPollRevision] = React.useState(0);
  const [runtime, setRuntime] = React.useState(null);
  const [sessionId, setSessionId] = React.useState(() => getProjectSessionId());
  const [sessionError, setSessionError] = React.useState(false);
  const [sessionTransitioning, setSessionTransitioning] = React.useState(false);
  const [settings, setSettings] = React.useState(() => ({
    ...DEFAULT_GENERATION_SETTINGS,
  }));
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const [stopRequested, setStopRequested] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const abortRef = React.useRef(null);
  const autoFollowRef = React.useRef(true);
  const defaultsAppliedRef = React.useRef(false);
  const fileInputRef = React.useRef(null);
  const generationRef = React.useRef(0);
  const stopRequestedRef = React.useRef(false);
  const transcriptRef = React.useRef(null);

  React.useEffect(() => {
    let disposed = false;
    let polling = false;
    let activeController = null;

    const poll = async () => {
      if (polling) {
        return;
      }

      polling = true;
      activeController = new globalThis.AbortController();

      try {
        await getHealth({ signal: activeController.signal });
        if (disposed) {
          return;
        }

        setConnection({ error: null, status: "online" });

        try {
          const runtimeData = await getRuntime({
            signal: activeController.signal,
          });
          if (disposed) {
            return;
          }

          setRuntime(runtimeData);
          if (!defaultsAppliedRef.current) {
            defaultsAppliedRef.current = true;
            setSettings(settingsFromRuntime(runtimeData));
          }
        } catch (error) {
          if (error.name !== "AbortError" && !disposed) {
            setConnection({ error: error.message, status: "online" });
          }
        }
      } catch (error) {
        if (error.name !== "AbortError" && !disposed) {
          setConnection({ error: error.message, status: "offline" });
        }
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
      activeController?.abort();
    };
  }, [pollRevision]);

  React.useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runtimeView = runtimePresentation({
    connection,
    runtime,
    sessionError,
    sessionTransitioning,
    stopRequested,
    streaming,
  });
  const runtimeReady = isRuntimeReady(connection, runtime);
  const canCompose =
    !sessionError && !sessionTransitioning && runtimeReady && !editor;
  const conversationHasImage = messages.some((message) => message.image);

  const updateSetting = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const runCompletion = React.useCallback(
    async (history) => {
      const generationId = generationRef.current + 1;
      generationRef.current = generationId;
      const controller = new globalThis.AbortController();
      abortRef.current = controller;
      autoFollowRef.current = true;
      setShowScrollButton(false);
      stopRequestedRef.current = false;
      setStopRequested(false);
      setStreaming(true);
      setEditor(null);

      const assistantId = newMessageId("assistant");
      const assistant = {
        error: null,
        id: assistantId,
        metrics: null,
        reasoning: "",
        reasoningDurationMs: null,
        reasoningStartedAt: null,
        role: "assistant",
        status: "streaming",
        text: "",
      };
      setMessages([...history, assistant]);

      const startedAt = globalThis.performance.now();
      let answerStartedAt = null;
      let firstTokenAt = null;
      let partialReasoning = "";
      let partialText = "";
      let reasoningStartedAt = null;

      try {
        const result = await streamChatCompletion({
          maxTokens: settings.maxTokens,
          messages: toOpenAiMessages({
            messages: history,
            systemPrompt,
          }),
          model: runtime?.modelId ?? runtime?.model ?? "muse-glimmer",
          reasoningStrength: settings.reasoningStrength,
          sessionId,
          signal: controller.signal,
          temperature: settings.temperature,
          topK: settings.topK,
          topP: settings.topP,
          onReasoningDelta(_delta, accumulatedReasoning) {
            if (generationRef.current !== generationId) {
              return;
            }

            const now = globalThis.performance.now();
            firstTokenAt ??= now;
            reasoningStartedAt ??= now;
            partialReasoning = accumulatedReasoning;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      reasoning: accumulatedReasoning,
                      reasoningStartedAt,
                    }
                  : message,
              ),
            );
          },
          onDelta(_delta, accumulatedText) {
            if (generationRef.current !== generationId) {
              return;
            }

            const now = globalThis.performance.now();
            firstTokenAt ??= now;
            answerStartedAt ??= now;
            partialText = accumulatedText;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      reasoningDurationMs: reasoningStartedAt
                        ? answerStartedAt - reasoningStartedAt
                        : null,
                      text: accumulatedText,
                    }
                  : message,
              ),
            );
          },
        });

        if (generationRef.current !== generationId) {
          return;
        }

        const endedAt = globalThis.performance.now();
        const wasStopped = stopRequestedRef.current;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  metrics: responseMetrics({
                    endedAt,
                    finishReason: wasStopped
                      ? "stopped"
                      : (result.finishReason ?? "stop"),
                    firstTokenAt,
                    runtimeMetrics: result.runtimeMetrics,
                    startedAt,
                    usage: result.usage,
                  }),
                  reasoning: result.reasoning,
                  reasoningDurationMs: reasoningStartedAt
                    ? (answerStartedAt ?? endedAt) - reasoningStartedAt
                    : null,
                  status: wasStopped ? "stopped" : "complete",
                  text: result.text,
                }
              : message,
          ),
        );
      } catch (error) {
        if (generationRef.current !== generationId) {
          return;
        }

        const stopped = stopRequestedRef.current || error.name === "AbortError";
        const endedAt = globalThis.performance.now();
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  error: stopped ? null : error.message,
                  metrics: responseMetrics({
                    endedAt,
                    finishReason: stopped ? "stopped" : "error",
                    firstTokenAt,
                    runtimeMetrics: null,
                    startedAt,
                    usage: null,
                  }),
                  reasoning: partialReasoning,
                  reasoningDurationMs: reasoningStartedAt
                    ? (answerStartedAt ?? endedAt) - reasoningStartedAt
                    : null,
                  status: stopped ? "stopped" : "error",
                  text: partialText,
                }
              : message,
          ),
        );
      } finally {
        if (generationRef.current === generationId) {
          abortRef.current = null;
          stopRequestedRef.current = false;
          setStopRequested(false);
          setStreaming(false);
        }
      }
    },
    [runtime, sessionId, settings, systemPrompt],
  );

  const sendMessage = () => {
    if (!canCompose || (!draft.trim() && !attachment)) {
      return;
    }

    const history = messages.filter(
      (message) => message.role !== "assistant" || message.text,
    );
    const userMessage = {
      id: newMessageId("user"),
      image: attachment,
      role: "user",
      text: draft.trim(),
    };

    setDraft("");
    setAttachment(null);
    void runCompletion([...history, userMessage]);
  };

  const regenerate = () => {
    if (streaming || editor) {
      return;
    }

    const lastAssistantIndex = messages.findLastIndex(
      (message) => message.role === "assistant",
    );
    if (lastAssistantIndex === -1) {
      return;
    }

    const history = messages.slice(0, lastAssistantIndex);
    void runCompletion(history);
  };

  const beginEditing = (message) => {
    if (streaming || sessionTransitioning || sessionError || editor) {
      return;
    }

    setEditor({ draft: message.text ?? "", id: message.id });
  };

  const saveEdit = async () => {
    if (!editor || streaming || sessionTransitioning) {
      return;
    }

    const edit = applyMessageEdit(messages, editor.id, editor.draft);
    if (!edit) {
      return;
    }

    let regenerationHistory = null;
    setSessionTransitioning(true);
    try {
      await resetSession(sessionId);
      setMessages(edit.messages);
      setEditor(null);
      autoFollowRef.current = true;
      setShowScrollButton(false);
      if (edit.regenerate) {
        regenerationHistory = edit.messages;
      }
    } catch (error) {
      toast.error(error.message || "The message could not be updated.");
    } finally {
      setSessionTransitioning(false);
    }

    if (regenerationHistory) {
      void runCompletion(regenerationHistory);
    }
  };

  const startNewChat = async () => {
    if (sessionTransitioning) {
      return;
    }

    const previousSessionId = sessionId;
    const activeController = abortRef.current;
    const wasStreaming = streaming;
    setSessionError(false);
    setSessionTransitioning(true);
    generationRef.current += 1;
    stopRequestedRef.current = false;
    setStopRequested(false);
    setStreaming(false);
    setEditor(null);
    setMessages([]);
    setDraft("");
    setAttachment(null);
    autoFollowRef.current = true;
    setShowScrollButton(false);

    try {
      if (wasStreaming) {
        try {
          const cancellation = await cancelGeneration(previousSessionId);
          if (!cancellation.cancelled) {
            activeController?.abort();
          }
        } catch {
          activeController?.abort();
        }
      }

      try {
        await deleteSession(previousSessionId);
        const nextSessionId = persistProjectSessionId(createSessionId());
        setSessionId(nextSessionId);
      } catch {
        await resetSession(previousSessionId);
      }
    } catch {
      setSessionError(true);
      toast.error("The model session could not be reset. Try New Chat again.");
    } finally {
      if (abortRef.current === activeController) {
        abortRef.current = null;
      }
      setSessionTransitioning(false);
    }
  };

  const stopGeneration = async () => {
    if (!streaming || stopRequestedRef.current) {
      return;
    }

    stopRequestedRef.current = true;
    setStopRequested(true);

    try {
      const cancellation = await cancelGeneration(sessionId);
      if (!cancellation.cancelled) {
        abortRef.current?.abort();
      }
    } catch (error) {
      stopRequestedRef.current = false;
      setStopRequested(false);
      toast.error(error.message || "Unable to stop generation.");
    }
  };

  const attachImage = async (file) => {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      toast.error("Choose a PNG or JPEG image.");
      return;
    }

    const maxImageBytes =
      finiteNumber(runtime?.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES) ||
      DEFAULT_MAX_IMAGE_BYTES;
    if (file.size > maxImageBytes) {
      toast.error(
        `Image must be smaller than ${(maxImageBytes / 1024 / 1024).toFixed(1)} MB.`,
      );
      return;
    }

    try {
      const dataUrl = await readImage(file);
      setAttachment({
        dataUrl,
        name: file.name,
        size: file.size,
        type: file.type,
      });
    } catch {
      toast.error("The image could not be read.");
    }
  };

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.text);
      return true;
    } catch {
      toast.error(
        `Unable to copy ${message.role === "user" ? "prompt" : "response"}.`,
      );
      return false;
    }
  };

  const settingsPanelProps = {
    onReset: () => setSettings(settingsFromRuntime(runtime)),
    onSettingChange: updateSetting,
    onSystemPromptChange: setSystemPrompt,
    runtime,
    settings,
    systemPrompt,
  };

  return (
    <TooltipProvider>
      <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
        <header className="relative flex h-12 shrink-0 items-center border-b px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 text-title-lg">Muse Glimmer</h1>
            <span className="hidden min-w-0 items-center gap-2 text-body-sm text-muted-foreground sm:flex">
              <span
                aria-hidden="true"
                data-corner-shape="round"
                data-tone={runtimeView.tone}
                className="runtime-dot"
              />
              <span className="truncate">{runtimeView.label}</span>
              {runtime?.device ? (
                <span className="hidden truncate md:inline">
                  · {runtime.device}
                </span>
              ) : null}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  aria-label="New chat"
                  disabled={sessionTransitioning}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void startNewChat()}
                >
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New chat</TooltipContent>
            </Tooltip>

            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SheetTrigger asChild>
                    <Button
                      type="button"
                      aria-label="Open playground settings"
                      className="lg:hidden"
                      size="icon-sm"
                      variant="ghost"
                    >
                      <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
                    </Button>
                  </SheetTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Playground</TooltipContent>
              </Tooltip>
              <SheetContent
                className="w-[min(92vw,22rem)] p-0 sm:max-w-[22rem]"
                showCloseButton={false}
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Playground settings</SheetTitle>
                  <SheetDescription>
                    Configure generation and inspect the local runtime.
                  </SheetDescription>
                </SheetHeader>
                <PlaygroundSettings
                  {...settingsPanelProps}
                  idPrefix="mobile"
                  headerAction={
                    <SheetClose asChild>
                      <Button
                        type="button"
                        aria-label="Close playground settings"
                        size="icon-sm"
                        variant="ghost"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                      </Button>
                    </SheetClose>
                  }
                />
              </SheetContent>
            </Sheet>

            <ThemeModeSwitcher />
          </div>

          {runtimeView.busy ? (
            <Progress
              aria-label={runtimeView.label}
              className="absolute inset-x-0 bottom-0 h-px rounded-none"
              indeterminate
            />
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatTranscript
              actionsDisabled={
                streaming ||
                sessionTransitioning ||
                sessionError ||
                Boolean(editor)
              }
              autoFollowRef={autoFollowRef}
              connection={connection}
              editDraft={editor?.draft ?? ""}
              editPending={sessionTransitioning}
              editingMessageId={editor?.id ?? null}
              messages={messages}
              runtime={runtime}
              runtimeView={runtimeView}
              setShowScrollButton={setShowScrollButton}
              showScrollButton={showScrollButton}
              streaming={streaming}
              transcriptRef={transcriptRef}
              onCancelEdit={() => setEditor(null)}
              onCopy={copyMessage}
              onEdit={beginEditing}
              onEditDraftChange={(value) =>
                setEditor((current) =>
                  current ? { ...current, draft: value } : current,
                )
              }
              onRegenerate={regenerate}
              onRetryConnection={() => setPollRevision((value) => value + 1)}
              onSaveEdit={() => void saveEdit()}
            />

            <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent pt-3">
              <ChatComposer
                attachment={attachment}
                canGenerate={canCompose}
                conversationHasImage={conversationHasImage}
                draft={draft}
                editing={Boolean(editor)}
                fileInputRef={fileInputRef}
                runtime={runtime}
                runtimeView={runtimeView}
                stopRequested={stopRequested}
                streaming={streaming}
                onAttachmentChange={setAttachment}
                onDraftChange={setDraft}
                onFileChange={attachImage}
                onStop={() => void stopGeneration()}
                onSubmit={sendMessage}
              />
            </div>

            <RuntimeStatus
              messages={messages}
              runtime={runtime}
              runtimeView={runtimeView}
              streaming={streaming}
            />
          </div>

          <aside
            aria-label="Playground settings"
            className="hidden min-h-0 w-72 shrink-0 border-l lg:flex"
          >
            <PlaygroundSettings {...settingsPanelProps} idPrefix="desktop" />
          </aside>
        </div>
      </main>
    </TooltipProvider>
  );
}
