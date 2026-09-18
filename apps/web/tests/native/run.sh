#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
for tool in bun unshare ip dbus-run-session xvfb-run WebKitWebDriver; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool. Run inside: nix develop .#tauri-e2e" >&2
    exit 1
  fi
done
if ! test -x "$root/apps/web/tauri/target/e2e/app"; then
  echo 'Build first: bun run native:e2e:build (from apps/web)' >&2
  exit 1
fi
# Isolate D-Bus, desktop registrations and WebKit as well as the cache. Never
# let portals use the developer's real session or runtime directory.
profile=$(mktemp -d -t macro-native-e2e-XXXXXXXX)
export HOME="$profile"
export XDG_CONFIG_HOME="$profile/config" XDG_DATA_HOME="$profile/data"
export XDG_CACHE_HOME="$profile/cache" XDG_RUNTIME_DIR="$profile/runtime"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
unset DBUS_SESSION_BUS_ADDRESS WAYLAND_DISPLAY
export GDK_BACKEND=x11 GTK_USE_PORTAL=0
child=
cleanup() {
  if [ -n "$child" ]; then kill -KILL "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
  rm -rf "$profile"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Only loopback exists; closing the fixture listener takes every API transport
# offline. No sudo, host firewall changes, hosted data, or port collisions.
unshare --user --map-root-user --net --pid --fork --mount-proc --kill-child=SIGKILL \
  bash -c 'set -euo pipefail
    ip link set lo up
    export MACRO_E2E_NETNS=1
    exec dbus-run-session -- xvfb-run --auto-servernum --server-args="-screen 0 1440x1000x24 -nolisten tcp" \
      bun "$1/apps/web/tests/native/runner.ts" "${@:2}"
  ' bash "$root" "$@" &
child=$!
wait "$child"
