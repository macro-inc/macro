#!/usr/bin/env bash
# Cold start and one warm reload for main, PR B and PR C bundles served by
# side-serve.mjs (29581 main, 29582 B, 29583 C), per viewer, with the device
# cache on and off. Run from the PR B worktree inside `nix develop`.
#   coldstart/run.sh <out> <viewer-label>=<session.json>...
set -uo pipefail
out="$1"; shift
mkdir -p "$out"
for pair in "$@"; do
  viewer="${pair%%=*}"; session="${pair#*=}"
  for build in main:29581 b:29582 c:29583; do
    name="${build%%:*}"; port="${build#*:}"
    for cache in on off; do
      dir="$out/$viewer-$name-$cache"
      echo "$(date -u +%T) $viewer $name cache=$cache"
      extra=""; [ "$cache" = off ] && extra="NO_CACHE=1"
      env $extra BASE="https://localhost:$port" UNTIL=quiet QUIET_MS=20000 WAIT_MS=900000 NODE_TLS_REJECT_UNAUTHORIZED=0 \
        node "$(dirname "$0")/browser-shadow.mjs" "$dir" "$session" 2 > "$dir.log" 2>&1
      echo "exit=$?"
    done
  done
done
