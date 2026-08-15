import { SESSION_STORAGE_KEY } from "@/lib/app-config";

export const DEFAULT_GENERATION_SETTINGS = Object.freeze({
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxTokens: 131072,
  reasoningStrength: "high",
});

export const REASONING_STRENGTHS = ["low", "medium", "high", "xhigh"];

export class ChatApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.payload = payload;
  }
}

function getFetch(fetchImpl) {
  return fetchImpl ?? globalThis.fetch;
}

async function responsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text || null;
}

function errorMessage(payload, fallback) {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (typeof payload?.error === "string") {
    return payload.error;
  }

  if (typeof payload?.error?.message === "string") {
    return payload.error.message;
  }

  if (typeof payload?.message === "string") {
    return payload.message;
  }

  if (typeof payload?.detail === "string") {
    return payload.detail;
  }

  return fallback;
}

async function fetchJson(path, { signal, fetchImpl } = {}) {
  const response = await getFetch(fetchImpl)(path, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await responsePayload(response);

  if (!response.ok) {
    throw new ChatApiError(
      errorMessage(payload, `Request failed with status ${response.status}.`),
      { status: response.status, payload },
    );
  }

  return payload ?? {};
}

export function getHealth(options) {
  return fetchJson("/health", options);
}

export function getRuntime(options) {
  return fetchJson("/api/runtime", options);
}

export async function deleteSession(sessionId, { signal, fetchImpl } = {}) {
  if (!sessionId) {
    return;
  }

  const response = await getFetch(fetchImpl)(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      signal,
    },
  );

  if (!response.ok && response.status !== 404) {
    const payload = await responsePayload(response);
    throw new ChatApiError(
      errorMessage(payload, `Unable to release session (${response.status}).`),
      { status: response.status, payload },
    );
  }
}

export async function resetSession(sessionId, { signal, fetchImpl } = {}) {
  if (!sessionId) {
    return;
  }

  const response = await getFetch(fetchImpl)(
    `/v1/sessions/${encodeURIComponent(sessionId)}/reset`,
    {
      method: "POST",
      signal,
    },
  );
  const payload = await responsePayload(response);

  if (!response.ok) {
    throw new ChatApiError(
      errorMessage(payload, `Unable to reset session (${response.status}).`),
      { status: response.status, payload },
    );
  }

  return payload ?? {};
}

export async function cancelGeneration(sessionId, { signal, fetchImpl } = {}) {
  const response = await getFetch(fetchImpl)("/api/cancel", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId }),
    signal,
  });

  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new ChatApiError(
      errorMessage(payload, `Unable to stop generation (${response.status}).`),
      { status: response.status, payload },
    );
  }

  return payload ?? {};
}

export function createSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `muse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function projectStorage(storage) {
  if (storage !== undefined) {
    return storage;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function validSessionId(sessionId) {
  return (
    typeof sessionId === "string" &&
    sessionId.length >= 1 &&
    sessionId.length <= 128 &&
    [...sessionId].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e;
    })
  );
}

export function persistProjectSessionId(sessionId, { storage } = {}) {
  if (!validSessionId(sessionId)) {
    throw new TypeError("Invalid Muse Glimmer session id.");
  }

  try {
    projectStorage(storage)?.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }

  return sessionId;
}

export function getProjectSessionId({ storage } = {}) {
  try {
    const stored = projectStorage(storage)?.getItem(SESSION_STORAGE_KEY);
    if (validSessionId(stored)) {
      return stored;
    }
  } catch {
    // Fall through to an in-memory id when storage is unavailable.
  }

  return persistProjectSessionId(createSessionId(), { storage });
}

function imageContent(image) {
  return {
    type: "image_url",
    image_url: {
      url: image.dataUrl,
    },
  };
}

export function toOpenAiMessages({ messages, systemPrompt }) {
  const systemMessage = systemPrompt.trim()
    ? [{ role: "system", content: systemPrompt.trim() }]
    : [];

  return [
    ...systemMessage,
    ...messages.map((message) => {
      if (message.role !== "user" || !message.image) {
        return { role: message.role, content: message.text };
      }

      const content = [];
      if (message.text.trim()) {
        content.push({ type: "text", text: message.text });
      }
      content.push(imageContent(message.image));

      return { role: "user", content };
    }),
  ];
}

function contentText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      return typeof part?.content === "string" ? part.content : "";
    })
    .join("");
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const promptTokens = optionalNumber(usage.prompt_tokens);
  const completionTokens = optionalNumber(usage.completion_tokens);
  const totalTokens = optionalNumber(usage.total_tokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRuntimeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }

  return {
    decodeMs: optionalNumber(metrics.decode_ms),
    decodeTokensPerSecond: optionalNumber(metrics.decode_tokens_per_second),
    prefillMs: optionalNumber(metrics.prefill_ms),
    prefillTokensPerSecond: optionalNumber(metrics.prefill_tokens_per_second),
    prefilledPromptTokens: optionalNumber(metrics.prefilled_prompt_tokens),
    reusedPromptTokens: optionalNumber(metrics.reused_prompt_tokens),
    sessionResetReason:
      typeof metrics.session_reset_reason === "string"
        ? metrics.session_reset_reason
        : null,
    thinkingTokens: optionalNumber(metrics.thinking_tokens),
    totalMs: optionalNumber(metrics.total_ms),
    visionEncoderMs: optionalNumber(metrics.vision_encoder_ms),
  };
}

export async function readOpenAiSse(
  response,
  { onDelta, onReasoningDelta } = {},
) {
  if (!response.body) {
    throw new ChatApiError("The server returned an empty streaming response.", {
      status: response.status,
    });
  }

  const reader = response.body.getReader();
  const decoder = new globalThis.TextDecoder();
  let buffer = "";
  let dataLines = [];
  let finishReason = null;
  let reasoning = "";
  let text = "";
  let usage = null;
  let receivedDone = false;
  let runtimeMetrics = null;

  const dispatchEvent = () => {
    if (dataLines.length === 0 || receivedDone) {
      dataLines = [];
      return;
    }

    const data = dataLines.join("\n").trim();
    dataLines = [];

    if (!data) {
      return;
    }

    if (data === "[DONE]") {
      receivedDone = true;
      return;
    }

    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw new ChatApiError("The server sent a malformed streaming event.", {
        payload: { data, cause: error },
      });
    }

    if (event.error) {
      throw new ChatApiError(
        errorMessage(event, "The model returned an error."),
        {
          payload: event,
        },
      );
    }

    const choice = event.choices?.[0];
    const reasoningDelta = contentText(choice?.delta?.reasoning_content);
    const delta = contentText(choice?.delta?.content);

    if (reasoningDelta) {
      reasoning += reasoningDelta;
      onReasoningDelta?.(reasoningDelta, reasoning);
    }

    if (delta) {
      text += delta;
      onDelta?.(delta, text);
    }

    if (choice?.finish_reason !== null && choice?.finish_reason !== undefined) {
      finishReason = choice.finish_reason;
    }

    if (event.usage) {
      usage = normalizeUsage(event.usage);
    }

    if (event.muse_metrics) {
      runtimeMetrics = normalizeRuntimeMetrics(event.muse_metrics);
    }
  };

  const processCompleteLines = (flush = false) => {
    while (true) {
      const newlineIndex = buffer.indexOf("\n");

      if (newlineIndex === -1) {
        if (flush && buffer.length > 0) {
          const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
          buffer = "";
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        return;
      }

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (line === "") {
        dispatchEvent();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
  };

  try {
    while (!receivedDone) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        processCompleteLines(true);
        dispatchEvent();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      processCompleteLines();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!receivedDone) {
    throw new ChatApiError(
      "The generation stream ended before the server marked it complete.",
    );
  }

  return { finishReason, reasoning, runtimeMetrics, text, usage };
}

export async function streamChatCompletion({
  fetchImpl,
  maxTokens,
  messages,
  model,
  onDelta,
  onReasoningDelta,
  reasoningStrength,
  sessionId,
  signal,
  temperature,
  topK,
  topP,
}) {
  if (!REASONING_STRENGTHS.includes(reasoningStrength)) {
    throw new TypeError(
      "Reasoning strength must be low, medium, high, or xhigh.",
    );
  }

  const response = await getFetch(fetchImpl)("/v1/chat/completions", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      top_p: topP,
      top_k: topK,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      chat_template_kwargs: {
        reasoning_strength: reasoningStrength,
        return_reasoning: true,
      },
      ...(sessionId ? { session_id: sessionId } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const payload = await responsePayload(response);
    throw new ChatApiError(
      errorMessage(
        payload,
        `The generation request failed with status ${response.status}.`,
      ),
      { status: response.status, payload },
    );
  }

  return readOpenAiSse(response, { onDelta, onReasoningDelta });
}
