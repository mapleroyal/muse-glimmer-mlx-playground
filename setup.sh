#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_PATH="$PROJECT_ROOT/Muse Glimmer.command"
LAUNCHER_TEMP=""

cleanup() {
  if [[ -n "$LAUNCHER_TEMP" ]]; then
    rm -f "$LAUNCHER_TEMP"
  fi
}
trap cleanup EXIT HUP INT TERM

write_launcher() {
  LAUNCHER_TEMP="$(mktemp "$PROJECT_ROOT/.muse-glimmer-launcher.XXXXXX")"
  # These lines are the generated script, so expansion must happen at launch.
  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -Eeuo pipefail' \
    '' \
    'PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"' \
    'exec "$PROJECT_ROOT/scripts/launch.sh" "$@"' \
    >"$LAUNCHER_TEMP"
  chmod 755 "$LAUNCHER_TEMP"
  mv -f "$LAUNCHER_TEMP" "$LAUNCHER_PATH"
  LAUNCHER_TEMP=""
}

cd "$PROJECT_ROOT"
printf '\n\033[1mMuse Glimmer setup\033[0m\n'
printf 'This prepares the local runtime and downloads about 21 GB.\n'

"$PROJECT_ROOT/scripts/bootstrap.sh"
write_launcher

printf '\n\033[1mLauncher ready\033[0m\n'
printf 'Double-click %s to open Muse Glimmer.\n' "$(basename "$LAUNCHER_PATH")"
printf 'Location: %s\n' "$LAUNCHER_PATH"
