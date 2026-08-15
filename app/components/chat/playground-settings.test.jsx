import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  PlaygroundSettings,
  REASONING_LEVELS,
} from "@/components/chat/playground-settings";

function findElement(node, predicate) {
  if (!React.isValidElement(node)) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  for (const child of React.Children.toArray(node.props.children)) {
    const match = findElement(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
}

function settingsTree({ contextLength, onSettingChange }) {
  return PlaygroundSettings({
    idPrefix: "test",
    onReset: vi.fn(),
    onSettingChange,
    onSystemPromptChange: vi.fn(),
    runtime: { contextLength },
    settings: {
      maxTokens: 131072,
      reasoningStrength: "high",
      temperature: 1,
      topK: 64,
      topP: 0.95,
    },
    systemPrompt: "",
  });
}

describe("PlaygroundSettings", () => {
  it("maps Muse's four reasoning-effort stops directly", () => {
    const onSettingChange = vi.fn();
    const tree = settingsTree({ contextLength: 131072, onSettingChange });
    const control = findElement(
      tree,
      (element) => element.props.id === "test-reasoning-effort",
    );

    expect(REASONING_LEVELS.map((level) => level.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(control?.props.value).toBe("high");

    control.props.onChange("medium");

    expect(onSettingChange).toHaveBeenCalledWith("reasoningStrength", "medium");
  });

  it("exposes and directly populates the full context limit", () => {
    const contextLength = 131072;
    const onSettingChange = vi.fn();
    const tree = settingsTree({ contextLength, onSettingChange });
    const input = findElement(
      tree,
      (element) => element.props.id === "test-max-tokens",
    );
    const label = findElement(
      tree,
      (element) => element.props.htmlFor === "test-max-tokens",
    );
    const button = findElement(
      tree,
      (element) =>
        element.props["aria-label"] ===
        `Set Max output to ${new Intl.NumberFormat().format(contextLength)}`,
    );

    expect(label?.props.children).toBe("Max output");
    expect(input?.props.max).toBe(contextLength);
    expect(button?.props.children).toBe("Max");
    expect(button?.props.title).toBe(
      `Use the full ${new Intl.NumberFormat().format(contextLength)}-token context limit`,
    );

    button.props.onClick();

    expect(onSettingChange).toHaveBeenCalledOnce();
    expect(onSettingChange).toHaveBeenCalledWith("maxTokens", contextLength);
  });
});
