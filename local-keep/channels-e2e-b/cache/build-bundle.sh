#!/usr/bin/env bash
# build-bundle.sh <name>: build the web bundle of the e2e-b worktree (flag on unless FLAG=off) into ~/.cache/channels-e2e-b/bundles/<name>.
set -euo pipefail
name=$1; d=$HOME/.cache/channels-e2e-b
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
\cd "$root/apps/web"
engine=$(stat -c %Y src/lib/graphql-cache/wasm/cache_wasm_bg.wasm 2>/dev/null)
$d/engine-check.sh "$engine"
if [ "${FLAG:-on}" = on ]; then export VITE_ENABLE_CHANNEL_LOCAL_SYNC=true; else unset VITE_ENABLE_CHANNEL_LOCAL_SYNC; fi
MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin \
  VITE_LOCAL_ONLY=true VITE_AI_EDITING_WORKER_URL=/ai-editing VITE_LOCAL_STACK=true \
  nix develop -c bun run --bun build > $d/logs/bundle-$name.log 2>&1
test -f dist/index.html
rm -rf "$d/bundles/$name"; mkdir -p "$d/bundles/$name"
cp -a dist/. "$d/bundles/$name/"
echo "$engine" > "$d/bundles/$name/.engine-built"
