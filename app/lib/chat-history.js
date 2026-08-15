export function applyMessageEdit(messages, messageId, draft) {
  const messageIndex = messages.findIndex(
    (message) => message.id === messageId,
  );
  if (messageIndex < 0) {
    return null;
  }

  const original = messages[messageIndex];
  const text = draft.trim();
  if (!text && !(original.role === "user" && original.image)) {
    return null;
  }

  const editedMessage =
    original.role === "user"
      ? { ...original, edited: true, text }
      : {
          ...original,
          edited: true,
          error: null,
          metrics: null,
          reasoning: "",
          reasoningDurationMs: null,
          reasoningStartedAt: null,
          status: "complete",
          text,
        };

  return {
    messages: [...messages.slice(0, messageIndex), editedMessage],
    regenerate: original.role === "user",
  };
}
