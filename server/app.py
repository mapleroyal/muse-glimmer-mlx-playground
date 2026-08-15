from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = PROJECT_ROOT / ".runtime"
EXECUTORCH_ROOT = RUNTIME_ROOT / "src" / "executorch"
FRONTEND_ROOT = PROJECT_ROOT / "build" / "client"


def _required_file(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise SystemExit(f"{label} is missing: {resolved}")
    return resolved


def _device_name() -> str:
    try:
        return subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "Apple silicon"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Muse Glimmer local playground")
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--pos-embed-path", type=Path, required=True)
    parser.add_argument("--tokenizer-path", type=Path, required=True)
    parser.add_argument("--hf-tokenizer", type=Path, required=True)
    parser.add_argument("--worker-bin", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3939)
    parser.add_argument("--model-id", default="muse-glimmer-30b")
    parser.add_argument("--max-context", type=int, default=131_072)
    parser.add_argument("--max-image-bytes", type=int, default=20 * 1024 * 1024)
    parser.add_argument("--max-sessions", type=int, default=2)
    parser.add_argument("--dflash-block-length", type=int, default=4)
    parser.add_argument("--dflash-n-draft", type=int, default=3)
    return parser


def main() -> None:
    cli = _parser().parse_args()
    model_path = _required_file(cli.model_path, "Model artifact")
    pos_embed_path = _required_file(cli.pos_embed_path, "Vision position table")
    tokenizer_path = _required_file(cli.tokenizer_path, "Tokenizer")
    worker_path = _required_file(cli.worker_bin, "ExecuTorch worker")
    hf_tokenizer = cli.hf_tokenizer.expanduser().resolve()
    if not hf_tokenizer.is_dir():
        raise SystemExit(f"Tokenizer directory is missing: {hf_tokenizer}")
    if not (FRONTEND_ROOT / "index.html").is_file():
        raise SystemExit("The browser app is not built. Run scripts/bootstrap.sh first.")

    sys.path.insert(0, str(EXECUTORCH_ROOT.parent))

    from fastapi import Body, HTTPException
    from fastapi.staticfiles import StaticFiles
    import uvicorn

    from executorch.examples.llm_server.python.chat_template import ChatTemplate
    from executorch.examples.llm_server.python.server import build_app
    from executorch.examples.llm_server.python.session_runtime import SessionRuntime
    from executorch.examples.models.muse_glimmer.serving.serve import (
        _ASSISTANT_HEADER,
        _MUSE_GLIMMER_HEADER_SPECIALS,
        _spawn,
        _tool_detector,
    )

    from muse_streaming import StreamingMuseGlimmerServingChat

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger("muse_glimmer_playground")
    logger.info("Loading Muse Glimmer into the ExecuTorch MLX worker…")
    load_started = time.perf_counter()

    upstream_args = SimpleNamespace(
        model_path=str(model_path),
        data_path=None,
        pos_embed_path=str(pos_embed_path),
        max_image_bytes=cli.max_image_bytes,
        tokenizer_path=str(tokenizer_path),
        hf_tokenizer=str(hf_tokenizer),
        model_id=cli.model_id,
        host=cli.host,
        port=cli.port,
        max_context=cli.max_context,
        num_runners=1,
        max_sessions=cli.max_sessions,
        warm_resume=True,
        tool_parser="atem",
        bos_id=200_000,
        eos_id=200_001,
        artifact_mode="dflash",
        dflash_block_length=cli.dflash_block_length,
        dflash_n_draft=cli.dflash_n_draft,
        dflash_draft_argmax=True,
        cuda_graph=False,
        worker_bin=str(worker_path),
    )
    template = ChatTemplate(
        upstream_args.hf_tokenizer,
        assistant_header=_ASSISTANT_HEADER,
        strip_rendered_bos=True,
        append_generation_prompt_after_tool_response=True,
    )
    runtime = SessionRuntime(_spawn(upstream_args))
    serving = StreamingMuseGlimmerServingChat(
        runtime,
        template,
        upstream_args.model_id,
        max_context=upstream_args.max_context,
        max_image_bytes=upstream_args.max_image_bytes,
        tool_detector_cls=_tool_detector(upstream_args.tool_parser),
        prompt_token_offset=1,
        content_filter_specials=_MUSE_GLIMMER_HEADER_SPECIALS,
    )
    app = build_app(serving, upstream_args.model_id)

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            runtime.close_worker()

    app.router.lifespan_context = lifespan
    load_time_ms = round((time.perf_counter() - load_started) * 1000)

    runtime_payload = {
        "state": "ready",
        "model": "Muse Glimmer 30B",
        "modelId": cli.model_id,
        "backend": "ExecuTorch · MLX / Metal",
        "artifact": "K-Quant 17G · DFlash · Vision",
        "device": _device_name(),
        "contextLength": cli.max_context,
        "maxImageBytes": cli.max_image_bytes,
        "modelBytes": model_path.stat().st_size,
        "loadTimeMs": load_time_ms,
        "dflashBlockLength": cli.dflash_block_length,
        "dflashDraftTokens": cli.dflash_n_draft,
        "executorchCommit": os.environ.get("MUSE_EXECUTORCH_COMMIT"),
        "supports": {"vision": True, "warmResume": cli.max_sessions > 1},
        "defaults": {
            "temperature": 1.0,
            "topP": 0.95,
            "topK": 64,
            "maxTokens": cli.max_context,
            "reasoningStrength": "high",
        },
    }

    @app.get("/api/runtime")
    async def runtime_info():
        return runtime_payload

    @app.post("/api/cancel")
    async def cancel_generation(payload: dict | None = Body(default=None)):
        body = payload or {}
        if set(body) - {"session_id"}:
            raise HTTPException(status_code=422, detail="Only session_id is accepted.")
        session_id = body.get("session_id")
        if session_id is not None and (
            not isinstance(session_id, str) or not 1 <= len(session_id) <= 128
        ):
            raise HTTPException(
                status_code=422,
                detail="session_id must be a string of 1-128 characters.",
            )
        try:
            cancelled = runtime.stop(session_id)
        except Exception as error:
            logger.exception("Unable to send a cancellation request to the worker")
            raise HTTPException(
                status_code=503, detail="The model worker is unavailable."
            ) from error
        return {"cancelled": cancelled, "session_id": session_id}

    app.mount("/", StaticFiles(directory=FRONTEND_ROOT, html=True), name="frontend")

    logger.info(
        "Muse Glimmer is ready in %.1f s at http://%s:%d",
        load_time_ms / 1000,
        cli.host,
        cli.port,
    )
    try:
        uvicorn.run(app, host=cli.host, port=cli.port, log_level="info")
    finally:
        # Lifespan normally owns shutdown. This also covers a bind/startup error
        # that occurs after the native worker has already loaded the model.
        runtime.close_worker()


if __name__ == "__main__":
    main()
