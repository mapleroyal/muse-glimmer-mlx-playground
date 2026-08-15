#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# runtime-config.sh is resolved from the runtime project root.
# shellcheck disable=SC1091
source "$PROJECT_ROOT/scripts/runtime-config.sh"
cd "$PROJECT_ROOT"

export NO_PROXY="127.0.0.1,localhost"
export no_proxy="$NO_PROXY"
export MUSE_EXECUTORCH_COMMIT

printf '\033]0;Muse Glimmer\007'
printf '\n\033[1mMuse Glimmer · ExecuTorch on Apple silicon\033[0m\n'
printf 'Checking the project-local runtime before launch.\n'

muse_server_ready() {
  curl --noproxy '*' --connect-timeout 1 --max-time 2 -fsS \
    "http://$MUSE_SERVER_HOST:$MUSE_SERVER_PORT/api/runtime" 2>/dev/null |
    grep -Fq "\"modelId\":\"$MUSE_MODEL_ID\""
}

is_project_server_pid() {
  local pid="$1"
  local command=""
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == "$MUSE_VENV_DIRECTORY/bin/python $PROJECT_ROOT/server/app.py "* ]]
}

is_project_worker_pid() {
  local pid="$1"
  local command=""
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == "$MUSE_WORKER_PATH --model_path $MUSE_ARTIFACT_PATH "* ]]
}

project_server_pids() {
  local pid=""
  while IFS= read -r pid; do
    if is_project_server_pid "$pid"; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -f "$PROJECT_ROOT/server/app.py" 2>/dev/null || true)
}

project_worker_pids() {
  local pid=""
  while IFS= read -r pid; do
    if is_project_worker_pid "$pid"; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -f "$MUSE_WORKER_PATH" 2>/dev/null || true)
}

stop_project_pids() {
  local validator="$1"
  shift
  local pids=("$@")
  local alive=0
  local pid=""

  ((${#pids[@]})) || return 0
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in {1..60}; do
    alive=0
    for pid in "${pids[@]}"; do
      if "$validator" "$pid"; then
        alive=1
      fi
    done
    ((alive == 0)) && break
    sleep 0.1
  done
  for pid in "${pids[@]}"; do
    if "$validator" "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

stop_project_servers() {
  local pids=()
  local pid=""
  while IFS= read -r pid; do
    pids+=("$pid")
  done < <(project_server_pids)
  stop_project_pids is_project_server_pid "${pids[@]}"
}

stop_project_workers() {
  local pids=()
  local pid=""
  while IFS= read -r pid; do
    pids+=("$pid")
  done < <(project_worker_pids)
  stop_project_pids is_project_worker_pid "${pids[@]}"
}

if muse_server_ready; then
  open "http://$MUSE_SERVER_HOST:$MUSE_SERVER_PORT"
  printf 'Muse Glimmer is already running. Opened it in your browser.\n'
  exit 0
fi

mkdir -p "$MUSE_RUNTIME_DIRECTORY"
LAUNCH_LOCK_DIRECTORY="$MUSE_RUNTIME_DIRECTORY/launch.lock"
if ! mkdir "$LAUNCH_LOCK_DIRECTORY" 2>/dev/null; then
  LAUNCH_OWNER_PID=""
  if [[ -f "$LAUNCH_LOCK_DIRECTORY/pid" ]]; then
    LAUNCH_OWNER_PID="$(<"$LAUNCH_LOCK_DIRECTORY/pid")"
  fi
  if [[ "$LAUNCH_OWNER_PID" =~ ^[0-9]+$ ]] && \
      kill -0 "$LAUNCH_OWNER_PID" 2>/dev/null; then
    printf 'Muse Glimmer is already starting in another window.\n'
    printf 'That window will open the browser when the model is ready.\n'
    exit 0
  fi
  rm -f "$LAUNCH_LOCK_DIRECTORY/pid"
  rmdir "$LAUNCH_LOCK_DIRECTORY" 2>/dev/null || {
    printf 'Unable to recover the stale launch lock at %s.\n' \
      "$LAUNCH_LOCK_DIRECTORY" >&2
    exit 1
  }
  mkdir "$LAUNCH_LOCK_DIRECTORY"
fi
printf '%s\n' "$$" >"$LAUNCH_LOCK_DIRECTORY/pid"

CAFFEINATE_PID=""
BROWSER_WAITER_PID=""
SERVER_PID=""
CLEANUP_COMPLETE=0
cleanup() {
  if [[ "$CLEANUP_COMPLETE" -eq 1 ]]; then
    return
  fi
  CLEANUP_COMPLETE=1
  trap - EXIT HUP INT TERM

  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in {1..60}; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      SERVER_COMMAND="$(ps -p "$SERVER_PID" -o command= 2>/dev/null || true)"
      if [[ "$SERVER_COMMAND" == "$MUSE_VENV_DIRECTORY/bin/python $PROJECT_ROOT/server/app.py "* ]]; then
        kill -KILL "$SERVER_PID" 2>/dev/null || true
      fi
    fi
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  stop_project_workers
  if [[ -n "$BROWSER_WAITER_PID" ]]; then
    kill "$BROWSER_WAITER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CAFFEINATE_PID" ]]; then
    kill "$CAFFEINATE_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$LAUNCH_LOCK_DIRECTORY/pid"
  rmdir "$LAUNCH_LOCK_DIRECTORY" 2>/dev/null || true
}

handle_signal() {
  local exit_status="$1"
  cleanup
  exit "$exit_status"
}

trap cleanup EXIT
trap 'handle_signal 129' HUP
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

ORPHANED_SERVER_PID="$(project_server_pids | head -n 1 || true)"
ORPHANED_WORKER_PID="$(project_worker_pids | head -n 1 || true)"
if [[ -n "$ORPHANED_SERVER_PID" || -n "$ORPHANED_WORKER_PID" ]]; then
  printf 'Stopping a leftover Muse Glimmer process from the previous run.\n'
  stop_project_servers
  stop_project_workers
fi

if nc -z "$MUSE_SERVER_HOST" "$MUSE_SERVER_PORT" >/dev/null 2>&1; then
  printf 'Port %s is already used by a different local app.\n' "$MUSE_SERVER_PORT" >&2
  printf 'Stop that app or change MUSE_SERVER_PORT in scripts/runtime-config.sh.\n' >&2
  exit 1
fi

caffeinate -dimsu -w $$ &
CAFFEINATE_PID=$!

"$PROJECT_ROOT/scripts/bootstrap.sh"

open_when_ready() {
  for _ in {1..900}; do
    if muse_server_ready; then
      open "http://$MUSE_SERVER_HOST:$MUSE_SERVER_PORT"
      return
    fi
    sleep 1
  done
  printf '\nThe server did not become ready. Review the terminal output above.\n' >&2
}

open_when_ready &
BROWSER_WAITER_PID=$!

printf '\nLoading the model. The browser will open when it is ready.\n'
printf 'Closing this window or pressing Control-C stops Muse Glimmer and frees its memory.\n\n'

"$MUSE_VENV_DIRECTORY/bin/python" "$PROJECT_ROOT/server/app.py" \
  --model-path "$MUSE_ARTIFACT_PATH" \
  --pos-embed-path "$MUSE_POS_EMBED_PATH" \
  --tokenizer-path "$MUSE_TOKENIZER_PATH" \
  --hf-tokenizer "$MUSE_MODEL_DIRECTORY" \
  --worker-bin "$MUSE_WORKER_PATH" \
  --model-id "$MUSE_MODEL_ID" \
  --max-context "$MUSE_CONTEXT_LENGTH" \
  --max-image-bytes "$MUSE_MAX_IMAGE_BYTES" \
  --host "$MUSE_SERVER_HOST" \
  --port "$MUSE_SERVER_PORT" &
SERVER_PID=$!

# Keep this small supervisor alive long enough to reap the gateway and remove
# runtime locks after Terminal hangs up. The already-started gateway and model
# worker retain the normal HUP behavior and exit with the Terminal session.
trap '' HUP
wait "$SERVER_PID"
