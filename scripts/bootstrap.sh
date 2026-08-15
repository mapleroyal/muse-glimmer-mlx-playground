#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIRECTORY/runtime-config.sh"

UV_VERSION="0.11.14"
UV_ARCHIVE_SHA256="4333af5c0730d94323a7819bbdf87ce92dd07fc857d67fff0059e0fca31b5c02"

section() {
  printf '\n\033[1m%s\033[0m\n' "$1"
}

fail() {
  printf '\nSetup stopped: %s\n' "$1" >&2
  exit 1
}

BOOTSTRAP_LOCK_DIRECTORY=""
release_bootstrap_lock() {
  if [[ -n "$BOOTSTRAP_LOCK_DIRECTORY" ]]; then
    rm -f "$BOOTSTRAP_LOCK_DIRECTORY/pid"
    rmdir "$BOOTSTRAP_LOCK_DIRECTORY" 2>/dev/null || true
  fi
}

acquire_bootstrap_lock() {
  BOOTSTRAP_LOCK_DIRECTORY="$MUSE_RUNTIME_DIRECTORY/bootstrap.lock"
  if ! mkdir "$BOOTSTRAP_LOCK_DIRECTORY" 2>/dev/null; then
    local owner_pid=""
    if [[ -f "$BOOTSTRAP_LOCK_DIRECTORY/pid" ]]; then
      owner_pid="$(<"$BOOTSTRAP_LOCK_DIRECTORY/pid")"
    fi
    if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null; then
      fail "Another Muse Glimmer setup is already running (process $owner_pid)."
    fi
    rm -f "$BOOTSTRAP_LOCK_DIRECTORY/pid"
    rmdir "$BOOTSTRAP_LOCK_DIRECTORY" 2>/dev/null || \
      fail "Unable to recover the stale setup lock at $BOOTSTRAP_LOCK_DIRECTORY."
    mkdir "$BOOTSTRAP_LOCK_DIRECTORY"
  fi
  printf '%s\n' "$$" >"$BOOTSTRAP_LOCK_DIRECTORY/pid"
  trap release_bootstrap_lock EXIT HUP INT TERM
}

ensure_apple_silicon() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "Muse Glimmer's MLX runtime requires macOS."
  [[ "$(uname -m)" == "arm64" ]] || fail "Muse Glimmer's MLX runtime requires Apple silicon."
  command -v xcodebuild >/dev/null 2>&1 || fail "Install Xcode before continuing."
  command -v git >/dev/null 2>&1 || fail "Install the Xcode command-line tools before continuing."
  command -v node >/dev/null 2>&1 || fail "Node.js 20.19 or 22.12 and newer is required."
  command -v npm >/dev/null 2>&1 || fail "npm is required."
  command -v curl >/dev/null 2>&1 || fail "curl is required."

  local node_supported
  node_supported="$(node -p 'const [major, minor] = process.versions.node.split(".").map(Number); Number((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23)')"
  (( node_supported == 1 )) || fail "Node.js 20.19 or 22.12 and newer is required."

  if ! xcrun metal --version >/dev/null 2>&1; then
    section "Installing Xcode's Metal compiler component"
    xcodebuild -downloadComponent MetalToolchain
    xcrun --kill-cache
  fi
  xcrun metal --version >/dev/null 2>&1 || fail "Xcode's Metal compiler component is unavailable."
}

resolve_uv() {
  local bundled_uv="$MUSE_RUNTIME_DIRECTORY/tools/uv"
  if [[ -x "$bundled_uv" ]]; then
    if [[ "$("$bundled_uv" --version 2>/dev/null)" == "uv $UV_VERSION"* ]]; then
      printf '%s\n' "$bundled_uv"
      return
    fi
    fail "The project-local uv executable is not the pinned $UV_VERSION release. Remove $bundled_uv and retry."
  fi

  section "Downloading the project-local Python environment manager" >&2
  local archive="$MUSE_RUNTIME_DIRECTORY/downloads/uv-aarch64-apple-darwin.tar.gz"
  local archive_part="$archive.part"
  local extract_directory
  mkdir -p "$(dirname "$archive")" "$(dirname "$bundled_uv")"
  if [[ ! -f "$archive" || \
        "$(shasum -a 256 "$archive" | awk '{print $1}')" != "$UV_ARCHIVE_SHA256" ]]; then
    rm -f "$archive_part"
    curl -fL --retry 5 --retry-all-errors \
      "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-aarch64-apple-darwin.tar.gz" \
      --output "$archive_part"
    [[ "$(shasum -a 256 "$archive_part" | awk '{print $1}')" == "$UV_ARCHIVE_SHA256" ]] || \
      fail "The downloaded uv archive failed checksum verification."
    mv "$archive_part" "$archive"
  fi
  extract_directory="$(mktemp -d "$MUSE_RUNTIME_DIRECTORY/tools/uv-extract.XXXXXX")"
  tar -xzf "$archive" -C "$extract_directory" --strip-components=1
  install -m 755 "$extract_directory/uv" "$bundled_uv.tmp"
  mv "$bundled_uv.tmp" "$bundled_uv"
  rm -rf "$extract_directory"
  printf '%s\n' "$bundled_uv"
}

ensure_python_environment() {
  section "Preparing the project-local Python environment"
  export UV_CACHE_DIR="$MUSE_RUNTIME_DIRECTORY/cache/uv"
  export UV_PYTHON_INSTALL_DIR="$MUSE_RUNTIME_DIRECTORY/python"
  export UV_PYTHON_INSTALL_BIN="0"
  export UV_TOOL_DIR="$MUSE_RUNTIME_DIRECTORY/tools/uv-tools"
  export PIP_CACHE_DIR="$MUSE_RUNTIME_DIRECTORY/cache/pip"

  UV_BINARY="$(resolve_uv)"
  "$UV_BINARY" python install 3.12
  if [[ ! -x "$MUSE_VENV_DIRECTORY/bin/python" ]]; then
    "$UV_BINARY" venv --python 3.12 "$MUSE_VENV_DIRECTORY"
  fi
  "$UV_BINARY" pip install \
    --python "$MUSE_VENV_DIRECTORY/bin/python" \
    --requirements "$MUSE_PROJECT_ROOT/server/requirements.txt"
  "$UV_BINARY" pip install \
    --python "$MUSE_VENV_DIRECTORY/bin/python" \
    torch==2.13.0 \
    --extra-index-url https://download.pytorch.org/whl/test/cpu \
    --index-strategy unsafe-best-match
}

ensure_executorch_source() {
  section "Preparing ExecuTorch"
  mkdir -p "$(dirname "$MUSE_EXECUTORCH_DIRECTORY")" "$MUSE_RUNTIME_DIRECTORY/stamps"

  if [[ ! -d "$MUSE_EXECUTORCH_DIRECTORY/.git" ]]; then
    if [[ -e "$MUSE_EXECUTORCH_DIRECTORY" ]]; then
      fail "$MUSE_EXECUTORCH_DIRECTORY exists but is not an ExecuTorch checkout."
    fi
    git clone --filter=blob:none --no-checkout --depth 1 \
      "$MUSE_EXECUTORCH_REPOSITORY" "$MUSE_EXECUTORCH_DIRECTORY"
  fi

  if ! git -C "$MUSE_EXECUTORCH_DIRECTORY" cat-file -e "$MUSE_EXECUTORCH_COMMIT^{commit}" 2>/dev/null; then
    git -C "$MUSE_EXECUTORCH_DIRECTORY" fetch --depth 1 origin "$MUSE_EXECUTORCH_COMMIT"
  fi

  local current_commit
  current_commit="$(git -C "$MUSE_EXECUTORCH_DIRECTORY" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$current_commit" != "$MUSE_EXECUTORCH_COMMIT" ]]; then
    git -C "$MUSE_EXECUTORCH_DIRECTORY" checkout --detach "$MUSE_EXECUTORCH_COMMIT"
  fi

  local source_stamp="$MUSE_RUNTIME_DIRECTORY/stamps/executorch-source-$MUSE_EXECUTORCH_COMMIT"
  if [[ ! -f "$source_stamp" ]]; then
    git -C "$MUSE_EXECUTORCH_DIRECTORY" submodule sync --recursive
    git -C "$MUSE_EXECUTORCH_DIRECTORY" submodule update \
      --init --recursive --depth 1 --jobs 8
    touch "$source_stamp"
  fi

  local patch_stamp
  patch_stamp="$MUSE_RUNTIME_DIRECTORY/stamps/executorch-patch-$MUSE_EXECUTORCH_COMMIT-$(shasum -a 256 "$MUSE_EXECUTORCH_PATCH" | awk '{print $1}')"
  if [[ ! -f "$patch_stamp" ]]; then
    if git -C "$MUSE_EXECUTORCH_DIRECTORY" apply --reverse --check "$MUSE_EXECUTORCH_PATCH" >/dev/null 2>&1; then
      : # The current checkout already contains this exact patch.
    else
      git -C "$MUSE_EXECUTORCH_DIRECTORY" apply --check "$MUSE_EXECUTORCH_PATCH"
      git -C "$MUSE_EXECUTORCH_DIRECTORY" apply "$MUSE_EXECUTORCH_PATCH"
    fi
    rm -f "$MUSE_RUNTIME_DIRECTORY"/stamps/executorch-patch-*
    touch "$patch_stamp"
  fi
}

ensure_executorch_build() {
  local patch_hash
  patch_hash="$(shasum -a 256 "$MUSE_EXECUTORCH_PATCH" | awk '{print $1}')"
  local build_stamp="$MUSE_RUNTIME_DIRECTORY/stamps/executorch-build-$MUSE_EXECUTORCH_COMMIT-$patch_hash"
  if [[ ! -x "$MUSE_WORKER_PATH" || ! -f "$build_stamp" ]]; then
    section "Building the optimized ExecuTorch MLX runtime"
    export PATH="$MUSE_VENV_DIRECTORY/bin:$PATH"
    export VIRTUAL_ENV="$MUSE_VENV_DIRECTORY"
    export CMAKE_GENERATOR="Ninja"
    CMAKE_BUILD_PARALLEL_LEVEL="$(sysctl -n hw.ncpu)"
    export CMAKE_BUILD_PARALLEL_LEVEL
    export Python3_ROOT_DIR="$MUSE_VENV_DIRECTORY"

    (
      cd "$MUSE_EXECUTORCH_DIRECTORY"
      cmake --workflow --preset mlx-release
    )
    (
      cd "$MUSE_EXECUTORCH_DIRECTORY/examples/models/muse-glimmer"
      cmake --workflow --preset muse-glimmer-mlx
    )
    rm -f "$MUSE_RUNTIME_DIRECTORY"/stamps/executorch-build-*
    touch "$build_stamp"
  fi

  [[ -x "$MUSE_WORKER_PATH" ]] || fail "The Muse Glimmer worker did not build."
  local mlx_metallib="$MUSE_EXECUTORCH_DIRECTORY/cmake-out/lib/mlx.metallib"
  [[ -s "$mlx_metallib" ]] || fail "The compiled MLX Metal library is missing."
  install -m 644 "$mlx_metallib" "$(dirname "$MUSE_WORKER_PATH")/mlx.metallib"
}

ensure_model() {
  section "Downloading the Muse Glimmer DFlash vision artifact"
  export HF_HOME="$MUSE_RUNTIME_DIRECTORY/cache/huggingface"
  export HF_HUB_CACHE="$MUSE_RUNTIME_DIRECTORY/cache/huggingface/hub"
  export HF_XET_CACHE="$MUSE_RUNTIME_DIRECTORY/cache/huggingface/xet"
  export HF_HUB_ENABLE_HF_TRANSFER="0"
  mkdir -p "$MUSE_MODEL_DIRECTORY"

  "$MUSE_VENV_DIRECTORY/bin/hf" download \
    "$MUSE_MODEL_REPOSITORY" \
    "$MUSE_ARTIFACT_DIRECTORY/$MUSE_MODEL_FILENAME" \
    "$MUSE_ARTIFACT_DIRECTORY/pos_embed.bin" \
    tokenizer.json \
    tokenizer_config.json \
    chat_template.jinja \
    LICENSE \
    USAGE_POLICY.md \
    --revision "$MUSE_MODEL_REVISION" \
    --local-dir "$MUSE_MODEL_DIRECTORY"

  [[ "$(stat -f '%z' "$MUSE_ARTIFACT_PATH" 2>/dev/null || true)" == "$MUSE_MODEL_BYTES" ]] || fail "The model artifact is missing or incomplete."
  [[ "$(stat -f '%z' "$MUSE_POS_EMBED_PATH" 2>/dev/null || true)" == "$MUSE_POS_EMBED_BYTES" ]] || fail "The vision position table is missing or incomplete."
  [[ -s "$MUSE_TOKENIZER_PATH" ]] || fail "The tokenizer is missing."
}

ensure_frontend() {
  section "Building the browser app"
  export npm_config_cache="$MUSE_RUNTIME_DIRECTORY/cache/npm"

  local dependency_stamp
  dependency_stamp="$MUSE_RUNTIME_DIRECTORY/stamps/npm-$(shasum -a 256 "$MUSE_PROJECT_ROOT/package-lock.json" | awk '{print $1}')"
  mkdir -p "$MUSE_RUNTIME_DIRECTORY/stamps"
  if [[ ! -f "$dependency_stamp" || \
        ! -x "$MUSE_PROJECT_ROOT/node_modules/.bin/react-router" || \
        ! -x "$MUSE_PROJECT_ROOT/node_modules/.bin/eslint" || \
        ! -x "$MUSE_PROJECT_ROOT/node_modules/.bin/vitest" ]]; then
    (
      cd "$MUSE_PROJECT_ROOT"
      npm ci
    )
    rm -f "$MUSE_RUNTIME_DIRECTORY"/stamps/npm-*
    touch "$dependency_stamp"
  fi
  (
    cd "$MUSE_PROJECT_ROOT"
    npm run build
  )
}

main() {
  mkdir -p "$MUSE_RUNTIME_DIRECTORY"
  acquire_bootstrap_lock
  ensure_apple_silicon
  ensure_python_environment
  ensure_executorch_source
  ensure_executorch_build
  ensure_model
  ensure_frontend
  section "Setup complete"
}

main "$@"
