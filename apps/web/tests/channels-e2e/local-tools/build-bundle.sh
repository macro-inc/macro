#!/usr/bin/env bash
# Build the web bundle of the base worktree as `just stack up` does (flag off unless
# VITE_ENABLE_GRAPHQL_SOUP is set) and stage it into an instance's frontend dir.
#   build-bundle.sh <instance>
set -euo pipefail
instance=$1
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
\cd "$root/apps/web"
MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin \
  VITE_LOCAL_ONLY=true VITE_AI_EDITING_WORKER_URL=/ai-editing VITE_LOCAL_STACK=true \
  nix develop -c bun run --bun build > ~/.cache/channels-e2e/logs/bundle-build.log 2>&1
test -f dist/index.html
dest="$root/infra/local/generated/$instance/frontend"
find "$dest" -mindepth 1 -delete
cp -a dist/. "$dest/"
