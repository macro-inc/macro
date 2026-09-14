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
# Isolate ALL transports, including native reqwest, websocket and telemetry.
# Only loopback exists; the fixture listener is closed to go offline. No sudo,
# host firewall changes, access to hosted data, or collisions with other ports.
exec unshare --user --map-root-user --net --pid --fork --mount-proc \
  bash -c 'set -euo pipefail
    ip link set lo up
    export MACRO_E2E_NETNS=1
    exec dbus-run-session -- xvfb-run --auto-servernum --server-args="-screen 0 1440x1000x24 -nolisten tcp" \
      bun "$1/apps/web/tests/native/runner.ts" "${@:2}"
  ' bash "$root" "$@"
