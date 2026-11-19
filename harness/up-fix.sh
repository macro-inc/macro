#!/usr/bin/env bash
# Bring up (or `update`) the `chb-fix` stack from the fix worktree, GraphQL flag on.
set -euo pipefail
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync-fixstack
export TMPDIR=/home/teo/.cache/channels-perf-b/tmp VITE_ENABLE_GRAPHQL_SOUP=true
if [ ! -d node_modules/playwright ]; then nix develop -c bun install --frozen-lockfile; fi
if [ "${1:-up}" = update ]; then
  exec nix develop -c just stack update --instance chb-fix --no-doppler
fi
exec nix develop -c just stack up --instance chb-fix --no-doppler --no-computers --traces off \
  --env-file /home/teo/.cache/channels-perf-b/fix-stack.env --verbose --json
