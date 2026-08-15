from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from contextvars import ContextVar

from executorch.examples.models.muse_glimmer.serving.serve import (
    MuseGlimmerServingChat,
    _extract_muse_glimmer_reasoning,
    _strip_muse_glimmer_header,
)
from executorch.examples.llm_server.python.errors import ContextLengthExceeded
from executorch.examples.llm_server.python.openai_transcript import (
    OpenAITranscriptState,
)
from executorch.examples.llm_server.python.protocol import (
    _new_id,
    ChatCompletionChunk,
    ChunkChoice,
    DeltaMessage,
    Usage,
)
from executorch.examples.llm_server.python.session_runtime import GenStats


_MESSAGE = "<|message|>"
_BODY_BOUNDARIES = ("<|eom|>", "<|eot|>", "<|start|>")
_RECIPIENT_RE = re.compile(
    r"(?:^|\s|<\|start\|>assistant)"
    r"to=([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)"
    r"(?:\s+constrain=[A-Za-z_][A-Za-z0-9_-]*)?\s*$"
)
# Upstream's structured context error does not expose the counted prompt size.
# Retain it per async request so this adapter can calculate the retry budget.
_COUNTED_PROMPT_TOKENS: ContextVar[int | None] = ContextVar(
    "muse_counted_prompt_tokens", default=None
)


def _partial_marker_tail(text: str, markers: tuple[str, ...]) -> int:
    maximum = min(len(text), max(map(len, markers)) - 1)
    for size in range(maximum, 0, -1):
        suffix = text[-size:]
        if any(marker.startswith(suffix) for marker in markers):
            return size
    return 0


class MuseHarmonyStreamFilter:
    """Incrementally split Harmony reasoning and user-visible messages.

    Muse emits private ``to=self`` reasoning before its user-facing message.
    Upstream's generic adapter waits for the entire turn so it can split those
    channels. This state machine performs the split at Harmony message
    boundaries, preserving true token streaming without leaking control syntax.
    """

    def __init__(self) -> None:
        self._state = "header"
        self._buffer = ""
        self._visible = False
        self._saw_header = False

    def feed(self, text: str) -> list[tuple[str, str]]:
        if not text:
            return []
        self._buffer += text
        output: list[tuple[str, str]] = []

        while self._buffer:
            if self._state == "header":
                marker_index = self._buffer.find(_MESSAGE)
                if marker_index < 0:
                    break
                header = self._buffer[:marker_index]
                self._buffer = self._buffer[marker_index + len(_MESSAGE) :]
                recipient_match = _RECIPIENT_RE.search(header)
                if recipient_match is None:
                    # Keep malformed/plain output intact and decide at flush.
                    self._buffer = header + _MESSAGE + self._buffer
                    break
                self._saw_header = True
                self._visible = recipient_match.group(1) != "self"
                self._state = "body"
                continue

            boundary_index = len(self._buffer)
            boundary = None
            for candidate in _BODY_BOUNDARIES:
                index = self._buffer.find(candidate)
                if index >= 0 and index < boundary_index:
                    boundary_index = index
                    boundary = candidate

            if boundary is not None:
                if boundary_index:
                    channel = "content" if self._visible else "reasoning"
                    output.append((channel, self._buffer[:boundary_index]))
                self._buffer = self._buffer[boundary_index + len(boundary) :]
                self._state = "header"
                self._visible = False
                if boundary == "<|start|>":
                    self._buffer = "<|start|>" + self._buffer
                continue

            keep = _partial_marker_tail(self._buffer, _BODY_BOUNDARIES)
            safe_length = len(self._buffer) - keep
            if safe_length <= 0:
                break
            channel = "content" if self._visible else "reasoning"
            output.append((channel, self._buffer[:safe_length]))
            self._buffer = self._buffer[safe_length:]

        return [(channel, part) for channel, part in output if part]

    def flush(self) -> list[tuple[str, str]]:
        if self._state == "body":
            channel = "content" if self._visible else "reasoning"
            result = self._buffer
        elif not self._saw_header:
            # A non-Harmony fallback should remain usable rather than disappear.
            reasoning, visible = _extract_muse_glimmer_reasoning(self._buffer)
            output = []
            if reasoning:
                output.append(("reasoning", reasoning))
            visible = _strip_muse_glimmer_header(visible)
            if visible:
                output.append(("content", visible))
            self._buffer = ""
            return output
        else:
            channel = "content"
            result = ""
        self._buffer = ""
        return [(channel, result)] if result else []


class MuseOpenAITranscriptState(OpenAITranscriptState):
    """Splice the exact Harmony turn after its generation header.

    Muse generates the recipient and message header as part of the token stream,
    while its rendered assistant history contains that header before the
    assistant content. Remove the rendered copy before splicing the resident
    token IDs so the worker sees an exact prompt prefix on the next turn.
    """

    def _normalize_scaffold(self, text_chunk: str, preamble: str):
        if preamble:
            return super()._normalize_scaffold(text_chunk, preamble)
        header = text_chunk.rfind(self._assist_hdr)
        if header < 0:
            return text_chunk
        return text_chunk[: header + len(self._assist_hdr)]

    def build_prompt_input(self, **kwargs):
        prompt = super().build_prompt_input(**kwargs)
        session_id = kwargs.get("session_id")
        if not session_id:
            return prompt

        # A reset intentionally clears exact ids, but an edited history may
        # retain earlier assistant turns. Preserve their ordinal positions as
        # text-only fingerprints so the newly generated turn is recorded at its
        # real index and exact-id warm reuse can resume on the following request.
        turns = self._turns.setdefault(session_id, [])
        assistant_messages = [
            message
            for message in kwargs["messages"]
            if message.role == "assistant"
        ]
        for message in assistant_messages[len(turns) :]:
            turns.append(
                {
                    "fp": self._assistant_fingerprint(
                        message.content, message.tool_calls
                    ),
                    "ids": None,
                    "preamble": "",
                }
            )
        return prompt


class StreamingMuseGlimmerServingChat(MuseGlimmerServingChat):
    """Muse adapter with live plain-chat streaming and buffered tool parsing."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._transcript = MuseOpenAITranscriptState(self._template)

    def _count_prompt_tokens(self, prompt):
        count = super()._count_prompt_tokens(prompt)
        _COUNTED_PROMPT_TOKENS.set(count)
        return count

    async def create(self, req):
        count_token = _COUNTED_PROMPT_TOKENS.set(None)
        try:
            try:
                return await super().create(req)
            except ContextLengthExceeded:
                prompt_tokens = _COUNTED_PROMPT_TOKENS.get()
                requested = req.resolved_max_tokens()
                if (
                    self._max_context is None
                    or prompt_tokens is None
                    or prompt_tokens >= self._max_context
                    or requested <= 0
                    or requested > self._max_context
                ):
                    raise

                remaining = self._max_context - prompt_tokens
                if requested <= remaining:
                    raise

                # Muse's native worker also clamps to its exact remaining room.
                # Retry with the server's matching prompt count so a valid output
                # cap does not become a pre-stream context-length error. Clone the
                # request so callers still see the value they originally sent.
                clamped = req.model_copy(deep=True)
                if clamped.max_completion_tokens is not None:
                    clamped.max_completion_tokens = remaining
                else:
                    clamped.max_tokens = remaining
                return await super().create(clamped)
        finally:
            _COUNTED_PROMPT_TOKENS.reset(count_token)

    def _extract_response(self, req, text: str):
        reasoning, text = _extract_muse_glimmer_reasoning(text)
        tool_calls = None
        if self._tools_active(req):
            parsed = self._tool_detector_cls().detect_and_parse(
                text, self._tool_schemas(req)
            )
            if parsed.calls:
                tool_calls = [self._to_openai_tool_call(call) for call in parsed.calls]
            text = parsed.normal_text
        if not self._return_reasoning(req):
            reasoning = None
        content = self._strip_specials(_strip_muse_glimmer_header(text)) or None
        return tool_calls, reasoning, content

    async def _stream_final_chunks(
        self,
        req,
        stats,
        use_tools,
        tool_calls,
        reasoning,
        content,
        stopped,
        chunk,
    ) -> AsyncIterator[str]:
        async for final_chunk in super()._stream_final_chunks(
            req,
            stats,
            use_tools,
            tool_calls,
            reasoning,
            content,
            stopped,
            chunk,
        ):
            yield final_chunk

        metrics = {
            "decode_ms": stats.decode_ms,
            "decode_tokens_per_second": stats.decode_tok_s,
            "prefill_ms": stats.prefill_ms,
            "prefill_tokens_per_second": stats.prefill_tok_s,
            "prefilled_prompt_tokens": stats.prefilled_prompt_tokens,
            "reused_prompt_tokens": stats.reused_prompt_tokens,
            "session_reset_reason": stats.session_reset_reason,
            "thinking_tokens": (
                self._template.count_tokens(reasoning) if reasoning else 0
            ),
            "total_ms": stats.total_ms,
            "vision_encoder_ms": stats.vision_encoder_ms,
        }
        yield f"data: {json.dumps({'muse_metrics': metrics})}\n\n"

    async def _stream(
        self,
        req,
        prompt,
        options,
        preamble="",
        gen_stops=None,
    ) -> AsyncIterator[str]:
        # Tool parsing still needs the upstream buffered path. Plain chat uses a
        # channel-aware incremental path because upstream buffers any request
        # configured with a reasoning extractor.
        if self._tools_active(req):
            async for event in super()._stream(
                req, prompt, options, preamble, gen_stops
            ):
                yield event
            return

        cid = _new_id("chatcmpl")

        def chunk(delta: DeltaMessage, finish=None) -> str:
            completion = ChatCompletionChunk(
                id=cid,
                model=self._model_id,
                choices=[ChunkChoice(delta=delta, finish_reason=finish)],
            )
            return f"data: {completion.model_dump_json(exclude_none=True)}\n\n"

        yield chunk(DeltaMessage(role="assistant"))

        stats = GenStats()
        stream_filter = MuseHarmonyStreamFilter()
        reasoning_parts: list[str] = []
        content_parts: list[str] = []
        return_reasoning = self._return_reasoning(req)

        try:
            async for token in self._runtime.generate_stream(
                req.session_id, prompt, options, stats
            ):
                for channel, part in stream_filter.feed(token):
                    if channel == "reasoning":
                        reasoning_parts.append(part)
                        if return_reasoning:
                            yield chunk(DeltaMessage(reasoning_content=part))
                    else:
                        content_parts.append(part)
                        yield chunk(DeltaMessage(content=part))
            for channel, part in stream_filter.flush():
                if channel == "reasoning":
                    reasoning_parts.append(part)
                    if return_reasoning:
                        yield chunk(DeltaMessage(reasoning_content=part))
                else:
                    content_parts.append(part)
                    yield chunk(DeltaMessage(content=part))
        except Exception as error:  # noqa: BLE001 - preserve the SSE contract
            payload = {
                "error": {
                    "message": f"Generation failed: {error}",
                    "type": "server_error",
                    "code": None,
                }
            }
            yield f"data: {json.dumps(payload)}\n\n"
            yield "data: [DONE]\n\n"
            return

        reasoning = "".join(reasoning_parts) or None
        content = "".join(content_parts) or None
        self._transcript.record_assistant_turn(
            session_id=req.session_id,
            content=content,
            tool_calls=None,
            generated_token_ids=stats.generated_token_ids,
            prior_turns=sum(
                1 for message in req.messages if message.role == "assistant"
            ),
            preamble=preamble,
        )

        async for event in self._stream_final_chunks(
            req,
            stats,
            False,
            None,
            reasoning,
            content,
            False,
            chunk,
        ):
            yield event

        if req.stream_options and req.stream_options.include_usage:
            usage = Usage(
                prompt_tokens=stats.prompt_tokens,
                completion_tokens=stats.completion_tokens,
                total_tokens=stats.prompt_tokens + stats.completion_tokens,
            )
            completion = ChatCompletionChunk(
                id=cid,
                model=self._model_id,
                choices=[],
                usage=usage,
            )
            yield f"data: {completion.model_dump_json(exclude_none=True)}\n\n"
        yield "data: [DONE]\n\n"
