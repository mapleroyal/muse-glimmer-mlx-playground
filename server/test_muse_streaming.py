from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / ".runtime" / "src"))

from server.muse_streaming import (  # noqa: E402
    MuseHarmonyStreamFilter,
    MuseOpenAITranscriptState,
    StreamingMuseGlimmerServingChat,
)
from executorch.examples.llm_server.python.protocol import (  # noqa: E402
    DeltaMessage,
)
from executorch.examples.llm_server.python.server import build_app  # noqa: E402
from executorch.examples.llm_server.python.worker_client import (  # noqa: E402
    WorkerClient,
)


HARMONY_TURN = (
    "to=self<|message|>private chain of thought<|eom|>"
    "<|start|>assistant to=user<|message|>Hello, world.<|eot|>"
)
HARMONY_TURN_WITHOUT_HEADER_SPACE = HARMONY_TURN.replace(
    "assistant to=user", "assistantto=user"
)


def filtered(*chunks: str) -> tuple[str, str, list[tuple[str, str]]]:
    stream_filter = MuseHarmonyStreamFilter()
    parts: list[tuple[str, str]] = []
    for chunk in chunks:
        parts.extend(stream_filter.feed(chunk))
    parts.extend(stream_filter.flush())
    reasoning = "".join(part for channel, part in parts if channel == "reasoning")
    content = "".join(part for channel, part in parts if channel == "content")
    return reasoning, content, parts


class MuseHarmonyStreamFilterTests(unittest.TestCase):
    def test_every_two_chunk_split_preserves_channels_without_controls(self) -> None:
        for split in range(len(HARMONY_TURN) + 1):
            with self.subTest(split=split):
                reasoning, content, parts = filtered(
                    HARMONY_TURN[:split], HARMONY_TURN[split:]
                )
                self.assertEqual(reasoning, "private chain of thought")
                self.assertEqual(content, "Hello, world.")
                self.assertTrue(all("<|" not in part for _, part in parts))

    def test_single_character_chunks_stream_both_channels_safely(self) -> None:
        reasoning, content, parts = filtered(*HARMONY_TURN)
        self.assertEqual(reasoning, "private chain of thought")
        self.assertEqual(content, "Hello, world.")
        self.assertGreater(len(parts), 1)
        self.assertTrue(all("<|" not in part for _, part in parts))

    def test_no_space_after_assistant_streams_at_every_split(self) -> None:
        for split in range(len(HARMONY_TURN_WITHOUT_HEADER_SPACE) + 1):
            with self.subTest(split=split):
                reasoning, content, parts = filtered(
                    HARMONY_TURN_WITHOUT_HEADER_SPACE[:split],
                    HARMONY_TURN_WITHOUT_HEADER_SPACE[split:],
                )
                self.assertEqual(reasoning, "private chain of thought")
                self.assertEqual(content, "Hello, world.")
                self.assertTrue(all("<|" not in part for _, part in parts))

    def test_plain_text_fallback_is_preserved_at_eof(self) -> None:
        reasoning, content, _ = filtered("A plain ", "fallback answer")
        self.assertEqual(reasoning, "")
        self.assertEqual(content, "A plain fallback answer")

    def test_reasoning_only_turn_stays_in_reasoning_channel(self) -> None:
        reasoning, content, _ = filtered(
            "to=self<|message|>still private<|eot|>"
        )
        self.assertEqual(reasoning, "still private")
        self.assertEqual(content, "")


class MuseOpenAITranscriptStateTests(unittest.TestCase):
    def test_harmony_history_header_is_removed_before_token_id_splice(self) -> None:
        state = MuseOpenAITranscriptState.__new__(MuseOpenAITranscriptState)
        state._assist_hdr = "<|start|>assistant"

        normalized = state._normalize_scaffold(
            "prefix<|start|>assistant to=user<|message|>", ""
        )

        self.assertEqual(normalized, "prefix<|start|>assistant")

    def test_text_only_placeholders_preserve_post_reset_turn_ordinals(self) -> None:
        state = MuseOpenAITranscriptState.__new__(MuseOpenAITranscriptState)
        state._turns = {}
        state._template = None
        retained = SimpleNamespace(
            content="Edited answer",
            role="assistant",
            tool_calls=None,
        )

        state.build_prompt_input(
            session_id="session-1",
            messages=[retained],
            rendered_prompt="rendered history",
            tools=None,
            template_kwargs={},
        )
        state.record_assistant_turn(
            session_id="session-1",
            content="New generated answer",
            tool_calls=None,
            generated_token_ids=[7, 8, 9],
            prior_turns=1,
        )

        turns = state._turns["session-1"]
        self.assertEqual(len(turns), 2)
        self.assertIsNone(turns[0]["ids"])
        self.assertEqual(turns[1]["ids"], [7, 8, 9])


class _FakeRuntime:
    async def generate_stream(self, session_id, prompt, options, stats):
        del session_id, prompt, options
        stats.prompt_tokens = 5
        stats.completion_tokens = 4
        stats.generated_token_ids = [1, 2, 3, 4]
        midpoint = len(HARMONY_TURN) // 2
        yield HARMONY_TURN[:midpoint]
        yield HARMONY_TURN[midpoint:]


class _BudgetTemplate:
    def __init__(self, prompt_tokens: int) -> None:
        self.prompt_tokens = prompt_tokens

    def render(self, messages, tools=None, template_kwargs=None) -> str:
        del messages, tools, template_kwargs
        return "PROMPT"

    def count_tokens(self, text: str) -> int:
        del text
        return self.prompt_tokens

    def turn_stop_sequences(self) -> list[str]:
        return []

    def special_tokens(self) -> list[str]:
        return []

    def generation_preamble(self, template_kwargs, tools=None) -> str:
        del template_kwargs, tools
        return ""


class _BudgetRuntime:
    def __init__(self) -> None:
        self.options = None

    async def generate_stream(self, session_id, prompt, options, stats):
        del session_id, prompt
        self.options = options
        stats.prompt_tokens = 8
        if False:
            yield ""


def _budget_app(*, prompt_tokens: int = 7, max_context: int = 16):
    runtime = _BudgetRuntime()
    serving = StreamingMuseGlimmerServingChat(
        runtime,
        _BudgetTemplate(prompt_tokens),
        "muse",
        max_context=max_context,
        prompt_token_offset=1,
    )
    return build_app(serving, "muse"), runtime


class _FakeTranscript:
    def __init__(self) -> None:
        self.recorded = None

    def record_assistant_turn(self, **kwargs) -> None:
        self.recorded = kwargs


class StreamingMuseGlimmerServingChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_metrics_count_reasoning_on_plain_and_tool_paths(self) -> None:
        serving = StreamingMuseGlimmerServingChat.__new__(
            StreamingMuseGlimmerServingChat
        )
        serving._model_id = "muse"
        serving._template = SimpleNamespace(
            count_tokens=lambda text: len(text.split())
        )
        serving._log_generation_stats = lambda *args: None
        request = SimpleNamespace(
            resolved_max_tokens=lambda: 32,
            session_id="session-1",
        )
        stats = SimpleNamespace(
            completion_tokens=4,
            decode_ms=45.6,
            decode_tok_s=43.2,
            finish_reason="stop",
            prefill_ms=123.4,
            prefill_tok_s=100,
            prefilled_prompt_tokens=2,
            reused_prompt_tokens=7,
            session_reset_reason="exact_prefix",
            total_ms=169,
            vision_encoder_ms=None,
        )

        def chunk(_delta, finish=None):
            return f"finish:{finish}\n"

        for use_tools in (False, True):
            with self.subTest(use_tools=use_tools):
                events = [
                    event
                    async for event in serving._stream_final_chunks(
                        request,
                        stats,
                        use_tools,
                        None,
                        "private chain of thought",
                        "Hello, world.",
                        False,
                        chunk,
                    )
                ]
                metrics = next(
                    json.loads(event[6:])["muse_metrics"]
                    for event in events
                    if event.startswith('data: {"muse_metrics"')
                )

                self.assertEqual(metrics["thinking_tokens"], 4)

    async def test_plain_stream_returns_reasoning_only_when_requested(self) -> None:
        for return_reasoning in (False, True):
            with self.subTest(return_reasoning=return_reasoning):
                serving = StreamingMuseGlimmerServingChat.__new__(
                    StreamingMuseGlimmerServingChat
                )
                serving._runtime = _FakeRuntime()
                serving._transcript = _FakeTranscript()
                serving._model_id = "muse"
                serving._tool_detector_cls = None

                async def final_chunks(*args):
                    chunk = args[-1]
                    yield chunk(DeltaMessage(), finish="stop")

                serving._stream_final_chunks = final_chunks
                request = SimpleNamespace(
                    chat_template_kwargs={"return_reasoning": return_reasoning},
                    messages=[SimpleNamespace(role="user")],
                    session_id="session-1",
                    stream_options=SimpleNamespace(include_usage=True),
                    tool_choice=None,
                    tools=None,
                )

                events = [
                    event
                    async for event in serving._stream(
                        request, SimpleNamespace(), SimpleNamespace()
                    )
                ]
                payloads = [
                    json.loads(event[6:])
                    for event in events
                    if event.startswith("data: {")
                ]
                reasoning = "".join(
                    payload.get("choices", [{}])[0]
                    .get("delta", {})
                    .get("reasoning_content", "")
                    for payload in payloads
                    if payload.get("choices")
                )
                content = "".join(
                    payload.get("choices", [{}])[0]
                    .get("delta", {})
                    .get("content", "")
                    for payload in payloads
                    if payload.get("choices")
                )

                self.assertEqual(
                    reasoning,
                    "private chain of thought" if return_reasoning else "",
                )
                self.assertEqual(content, "Hello, world.")
                self.assertEqual(events[-1], "data: [DONE]\n\n")
                self.assertEqual(
                    serving._transcript.recorded["content"], "Hello, world."
                )


class ContextBudgetTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    async def request(app, **parameters):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(
                "/v1/chat/completions",
                json={
                    "model": "muse",
                    "messages": [{"role": "user", "content": "Hello"}],
                    **parameters,
                },
            )

    async def test_valid_output_caps_are_clamped_to_remaining_context(self) -> None:
        for requested, expected in ((8, 8), (10, 8), (16, 8)):
            with self.subTest(requested=requested):
                app, runtime = _budget_app()
                response = await self.request(app, max_tokens=requested)

                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(runtime.options.max_new_tokens, expected)

    async def test_max_completion_tokens_is_the_clamped_active_field(self) -> None:
        app, runtime = _budget_app()
        response = await self.request(
            app,
            max_tokens=2,
            max_completion_tokens=16,
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(runtime.options.max_new_tokens, 8)

    async def test_genuinely_oversized_output_cap_is_still_rejected(self) -> None:
        app, runtime = _budget_app()
        response = await self.request(app, max_tokens=17)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "context_length_exceeded")
        self.assertIsNone(runtime.options)

    async def test_prompt_filling_context_is_still_rejected(self) -> None:
        app, runtime = _budget_app(prompt_tokens=15)
        response = await self.request(app, max_tokens=1)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "context_length_exceeded")
        self.assertIsNone(runtime.options)

    async def test_nonpositive_output_cap_keeps_invalid_value_validation(self) -> None:
        app, runtime = _budget_app()
        response = await self.request(app, max_tokens=0)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_value")
        self.assertIsNone(runtime.options)


class _FakeWorkerProcess:
    def __init__(self) -> None:
        self.stdin = io.StringIO()
        self.returncode = None

    def poll(self):
        return None


class WorkerCancellationTests(unittest.TestCase):
    def test_cancel_only_targets_the_current_generation(self) -> None:
        process = _FakeWorkerProcess()
        client = WorkerClient(process)

        self.assertFalse(client.stop("session-a"))
        with client._generation_state_lock:
            client._generation_active = True
            client._active_session_id = "session-a"

        self.assertFalse(client.stop("session-b"))
        self.assertEqual(process.stdin.getvalue(), "")
        self.assertTrue(client.stop("session-a"))
        self.assertEqual(
            json.loads(process.stdin.getvalue()),
            {"op": "cancel"},
        )


if __name__ == "__main__":
    unittest.main()
