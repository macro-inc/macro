#!/usr/bin/env bash
# loadgen.sh <n>: n web builds in the fixstack worktree, one after another, as machine load. Output is not staged.
export TMPDIR=/home/teo/.cache/channels-perf-b/tmp
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync-fixstack/apps/web
for i in $(seq 1 "${1:-3}"); do
  MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true VITE_LOCAL_STACK=true VITE_ENABLE_GRAPHQL_SOUP=true \
    nix develop ../.. -c bun run --bun build > $TMPDIR/loadbuild.log 2>&1
done
