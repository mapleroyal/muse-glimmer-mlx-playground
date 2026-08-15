#!/usr/bin/env bash
# shellcheck disable=SC2034

# Pinned to the upstream commit that introduced the public Muse Glimmer
# ExecuTorch implementation. The model revision is pinned for the same reason:
# the serialized PTE and runtime stay reproducible as upstream evolves.
MUSE_EXECUTORCH_REPOSITORY="https://github.com/pytorch/executorch.git"
MUSE_EXECUTORCH_COMMIT="52b176fd9d5d5252f5010e60f17adfea83e8433d"

MUSE_MODEL_REPOSITORY="meta-models/Muse-Glimmer-30B-ExecuTorch-PTE"
MUSE_MODEL_REVISION="b0376783689fb024c95b43a063552f938c678ec2"
MUSE_ARTIFACT_DIRECTORY="muse-glimmer-k-quant-17G-128K-text-image-dflash-metal"
MUSE_MODEL_FILENAME="muse-glimmer-k-quant-17G-128K-text-image-dflash-metal.pte"
MUSE_MODEL_BYTES="21055028608"
MUSE_POS_EMBED_BYTES="6291456"

MUSE_MODEL_ID="muse-glimmer-30b"
MUSE_CONTEXT_LENGTH="131072"
MUSE_MAX_IMAGE_BYTES="20971520"
MUSE_SERVER_HOST="127.0.0.1"
MUSE_SERVER_PORT="3939"

MUSE_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUSE_RUNTIME_DIRECTORY="$MUSE_PROJECT_ROOT/.runtime"
MUSE_EXECUTORCH_DIRECTORY="$MUSE_RUNTIME_DIRECTORY/src/executorch"
MUSE_VENV_DIRECTORY="$MUSE_RUNTIME_DIRECTORY/venv"
MUSE_MODEL_DIRECTORY="$MUSE_RUNTIME_DIRECTORY/models/muse-glimmer"
MUSE_ARTIFACT_PATH="$MUSE_MODEL_DIRECTORY/$MUSE_ARTIFACT_DIRECTORY/$MUSE_MODEL_FILENAME"
MUSE_POS_EMBED_PATH="$MUSE_MODEL_DIRECTORY/$MUSE_ARTIFACT_DIRECTORY/pos_embed.bin"
MUSE_TOKENIZER_PATH="$MUSE_MODEL_DIRECTORY/tokenizer.json"
MUSE_WORKER_PATH="$MUSE_EXECUTORCH_DIRECTORY/cmake-out/examples/models/muse-glimmer/muse_glimmer_worker"
MUSE_EXECUTORCH_PATCH="$MUSE_PROJECT_ROOT/patches/executorch-muse-cancel.patch"
