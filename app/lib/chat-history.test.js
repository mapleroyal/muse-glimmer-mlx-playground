import { describe, expect, it } from "vitest";

import { applyMessageEdit } from "@/lib/chat-history";

describe("applyMessageEdit", () => {
  it("preserves a user image, replaces the prompt, and truncates descendants", () => {
    const image = { dataUrl: "data:image/png;base64,abc", name: "chart.png" };
    const result = applyMessageEdit(
      [
        { id: "user-1", image, role: "user", text: "Old prompt" },
        { id: "assistant-1", role: "assistant", text: "Old answer" },
      ],
      "user-1",
      "  New prompt  ",
    );

    expect(result).toEqual({
      messages: [
        {
          edited: true,
          id: "user-1",
          image,
          role: "user",
          text: "New prompt",
        },
      ],
      regenerate: true,
    });
  });

  it("clears model-only artifacts when an assistant response is edited", () => {
    const result = applyMessageEdit(
      [
        { id: "user-1", role: "user", text: "Question" },
        {
          error: "Old error",
          id: "assistant-1",
          metrics: { tokensPerSecond: 40 },
          reasoning: "Old thought",
          reasoningDurationMs: 1200,
          reasoningStartedAt: 10,
          role: "assistant",
          status: "error",
          text: "Old answer",
        },
        { id: "user-2", role: "user", text: "Descendant" },
      ],
      "assistant-1",
      "Replacement answer",
    );

    expect(result).toEqual({
      messages: [
        { id: "user-1", role: "user", text: "Question" },
        {
          edited: true,
          error: null,
          id: "assistant-1",
          metrics: null,
          reasoning: "",
          reasoningDurationMs: null,
          reasoningStartedAt: null,
          role: "assistant",
          status: "complete",
          text: "Replacement answer",
        },
      ],
      regenerate: false,
    });
  });

  it("rejects an empty response but permits an image-only user prompt", () => {
    expect(
      applyMessageEdit(
        [{ id: "assistant-1", role: "assistant", text: "Answer" }],
        "assistant-1",
        "   ",
      ),
    ).toBeNull();

    expect(
      applyMessageEdit(
        [
          {
            id: "user-1",
            image: { dataUrl: "data:image/png;base64,abc" },
            role: "user",
            text: "Describe this",
          },
        ],
        "user-1",
        "",
      ),
    ).toMatchObject({ regenerate: true });
  });
});
