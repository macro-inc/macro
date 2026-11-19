#!/usr/bin/env bash
# ui.sh <stack port> <ui port>: Playwright UI mode for the channels e2e suite against https://localhost:<stack port>,
# listening on 127.0.0.1:<ui port> only (publish it with `tailscale serve`). Runs in the same private network
# namespace as run.sh; the UI port is forwarded out of it through a unix socket.
# Inside the namespace the UI binds 0.0.0.0 (reachable only through the forward): bound to loopback, Playwright
# refuses any Host header but localhost, which is what a proxy sends it.
# Uses casts 4 and 5 (two workers) so it does not share people with a whole-suite run on casts 0-3.
set -u
port=$1; ui=$2
if [ "${CHE2E_UI_STAGE:-}" != inner ]; then
  case $port in 24909|30709) export VITE_ENABLE_GRAPHQL_SOUP=true;; *) unset VITE_ENABLE_GRAPHQL_SOUP;; esac
  \cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base/apps/web
  export CHANNELS_E2E_STACK_URL=https://localhost:$port
  export CHANNELS_E2E_RUN_DIR=$HOME/.cache/channels-e2e/runs/$port-ui
  export CHANNELS_E2E_FIRST_CAST=${CHANNELS_E2E_FIRST_CAST:-4} CHANNELS_E2E_WORKERS=${CHANNELS_E2E_WORKERS:-2}
  mkdir -p "$CHANNELS_E2E_RUN_DIR"
  # This box runs close to its inotify instance limit; without polling UI mode dies with EMFILE when a browser connects.
  export CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000
  export CHE2E_UI_STAGE=inner
  exec nix shell nixpkgs#socat -c nix develop -c "$0" "$port" "$ui"
fi
in="${XDG_RUNTIME_DIR:-/tmp}/che2e-ui-$port-in.sock"; out="${XDG_RUNTIME_DIR:-/tmp}/che2e-ui-$port-out.sock"
socat "UNIX-LISTEN:$in,fork,unlink-early,unlink-close" "TCP:127.0.0.1:$port" & a=$!
socat "TCP-LISTEN:$ui,bind=127.0.0.1,fork,reuseaddr" "UNIX-CONNECT:$out" & b=$!
trap 'kill $a $b 2>/dev/null' EXIT
sleep 1
/usr/bin/bwrap --unshare-net --dev-bind / / sh -c '
  port=$1; ui=$2; in=$3; out=$4
  ip link set lo up 2>/dev/null
  socat "TCP-LISTEN:$port,fork,reuseaddr" "UNIX-CONNECT:$in" &
  socat "UNIX-LISTEN:$out,fork,unlink-early,unlink-close" "TCP:127.0.0.1:$ui" &
  sleep 1
  exec env -u LD_LIBRARY_PATH bunx playwright test --config tests/channels-e2e/playwright.config.ts --ui --ui-host 0.0.0.0 --ui-port "$ui"
' sh "$port" "$ui" "$in" "$out"
