#!/usr/bin/env bash
# Build the main and top-of-reads bundles the way the local stack does, both with the GraphQL flag on.
set -uo pipefail
R=/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
T=/home/teo/.cache/channels-perf-b/tmp
build() { # name
  local w=$T/mb-$1
  \cd $w/apps/web || return 1
  export WASM_PKG_CACHE_DIR=$HOME/.cache/macro-local/wasm-pkgs TMPDIR=$T
  nix develop $R --command bash -c "set -e; (\\cd $w && bun install --frozen-lockfile >/dev/null 2>&1); bun run dev:prepare >/dev/null 2>&1; MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true VITE_AI_EDITING_WORKER_URL=/ai-editing VITE_LOCAL_STACK=true VITE_ENABLE_GRAPHQL_SOUP=true bun run --bun build 2>&1 | tail -3 | cut -c1-200"
  echo "$1 rc=$? $(date -u +%T) index=$(ls $w/apps/web/dist/index.html 2>/dev/null) head=$(git -C $w rev-parse --short HEAD)"
  [ -f $w/apps/web/dist/index.html ] && rm -rf $T/bundle-$1 && cp -a $w/apps/web/dist $T/bundle-$1
}
build main
build reads
echo BUILD_DONE
