#!/usr/bin/env bash
# stagebuild.sh: build the fixstack worktree's web bundle the way the other suite session does and serve it from chb-fix.
set -euo pipefail
W=/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync-fixstack
D=$W/infra/local/generated/chb-fix/frontend
export TMPDIR=/home/teo/.cache/channels-perf-b/tmp
\cd $W/apps/web
MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true \
  VITE_AI_EDITING_WORKER_URL=/ai-editing VITE_LOCAL_STACK=true VITE_ENABLE_GRAPHQL_SOUP=true \
  nix develop ../.. -c bun run --bun build > $TMPDIR/stagebuild.log 2>&1
test -f dist/index.html
find "$D" -mindepth 1 -delete
cp -a dist/. "$D/"
cat dist/semver.txt
