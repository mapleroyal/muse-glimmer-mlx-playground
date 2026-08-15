import { describe, expect, it, vi } from "vitest";

import {
  cancelGeneration,
  DEFAULT_GENERATION_SETTINGS,
  getProjectSessionId,
  persistProjectSessionId,
  readOpenAiSse,
  resetSession,
  streamChatCompletion,
  toOpenAiMessages,
} from "@/lib/chat-api";

describe("generation defaults", () => {
  it("starts at full context with high reasoning effort", () => {
    expect(DEFAULT_GENERATION_SETTINGS).toMatchObject({
      maxTokens: 131072,
      reasoningStrength: "high",
    });
  });
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
  };
}

function streamingResponse(chunks) {
  const encoder = new globalThis.TextEncoder();
  return new globalThis.Response(
    new globalThis.ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("readOpenAiSse", () => {
  it("handles chunk boundaries, CRLF events, completion usage, and DONE", async () => {
    const onDelta = vi.fn();
    const onReasoningDelta = vi.fn();
    const response = streamingResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"Che',
      'ck this"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"},"finish_reason":null}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      'data: {"muse_metrics":{"prefill_ms":123.4,"decode_ms":45.6,"total_ms":169,"decode_tokens_per_second":43.2,"prefill_tokens_per_second":100,"reused_prompt_tokens":7,"prefilled_prompt_tokens":2,"session_reset_reason":"exact_prefix","thinking_tokens":4,"vision_encoder_ms":null}}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\n',
      "data: [DONE]\n\n",
    ]);

    await expect(
      readOpenAiSse(response, { onDelta, onReasoningDelta }),
    ).resolves.toEqual({
      finishReason: "stop",
      reasoning: "Check this",
      runtimeMetrics: {
        decodeMs: 45.6,
        decodeTokensPerSecond: 43.2,
        prefillMs: 123.4,
        prefillTokensPerSecond: 100,
        prefilledPromptTokens: 2,
        reusedPromptTokens: 7,
        sessionResetReason: "exact_prefix",
        thinkingTokens: 4,
        totalMs: 169,
        visionEncoderMs: null,
      },
      text: "Hello world",
      usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
    });
    expect(onDelta).toHaveBeenNthCalledWith(1, "Hello", "Hello");
    expect(onDelta).toHaveBeenNthCalledWith(2, " world", "Hello world");
    expect(onReasoningDelta).toHaveBeenCalledWith("Check this", "Check this");
  });

  it("rejects a connection that closes without the DONE sentinel", async () => {
    const response = streamingResponse([
      'data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":null}]}\n\n',
    ]);

    await expect(readOpenAiSse(response)).rejects.toThrow(
      "ended before the server marked it complete",
    );
  });

  it("keeps missing usage values null instead of coercing them to zero", async () => {
    const response = streamingResponse([
      'data: {"choices":[],"usage":{"prompt_tokens":null,"completion_tokens":null,"total_tokens":null}}\n\n',
      "data: [DONE]\n\n",
    ]);

    await expect(readOpenAiSse(response)).resolves.toMatchObject({
      usage: {
        completionTokens: null,
        promptTokens: null,
        totalTokens: null,
      },
    });
  });
});

describe("toOpenAiMessages", () => {
  it("preserves a custom system prompt and multimodal history", () => {
    const messages = toOpenAiMessages({
      systemPrompt: "Be concise.",
      messages: [
        {
          role: "user",
          text: "What is this?",
          image: { dataUrl: "data:image/png;base64,abc" },
        },
        {
          role: "assistant",
          reasoning: "Internal analysis stays server-side.",
          text: "A test image.",
        },
      ],
    });

    expect(messages[0]).toEqual({
      role: "system",
      content: "Be concise.",
    });
    expect(messages[1].content).toEqual([
      { type: "text", text: "What is this?" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,abc" },
      },
    ]);
    expect(messages[2]).toEqual({
      role: "assistant",
      content: "A test image.",
    });
  });
});

describe("streamChatCompletion", () => {
  it("sends the OpenAI streaming request shape", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamingResponse([
          'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );

    await streamChatCompletion({
      fetchImpl,
      maxTokens: 2048,
      messages: [{ role: "user", content: "Hello" }],
      model: "muse",
      reasoningStrength: "medium",
      sessionId: "session-1",
      temperature: 1,
      topK: 64,
      topP: 0.95,
    });

    const [, request] = fetchImpl.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      max_tokens: 2048,
      messages: [{ role: "user", content: "Hello" }],
      model: "muse",
      chat_template_kwargs: {
        reasoning_strength: "medium",
        return_reasoning: true,
      },
      session_id: "session-1",
      stream: true,
      stream_options: { include_usage: true },
      temperature: 1,
      top_k: 64,
      top_p: 0.95,
    });
  });
});

describe("cancelGeneration", () => {
  it("requests server-side cancellation for the active session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ cancelled: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(cancelGeneration("session-1", { fetchImpl })).resolves.toEqual(
      { cancelled: true },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/cancel",
      expect.objectContaining({
        body: JSON.stringify({ session_id: "session-1" }),
        method: "POST",
      }),
    );
  });
});

describe("resetSession", () => {
  it("clears a named session while retaining its slot", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new globalThis.Response(JSON.stringify({ reset: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(resetSession("session-1", { fetchImpl })).resolves.toEqual({
      reset: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/v1/sessions/session-1/reset", {
      method: "POST",
      signal: undefined,
    });
  });
});

describe("project session id", () => {
  it("reuses the project session across page mounts", () => {
    const storage = memoryStorage();
    const first = getProjectSessionId({ storage });
    const second = getProjectSessionId({ storage });

    expect(second).toBe(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("persists a replacement after New Chat", () => {
    const storage = memoryStorage();
    getProjectSessionId({ storage });

    persistProjectSessionId("replacement-session", { storage });

    expect(getProjectSessionId({ storage })).toBe("replacement-session");
  });
});
