#!/usr/bin/env bash
# Bring up the `che2e-b` headless stack from my own checkout of approach B (8408dabf70), flag on.
set -euo pipefail
\cd /home/teo/.herdr/worktrees/macro/che2e-b
export TMPDIR=/home/teo/.cache/channels-e2e/tmp
export VITE_ENABLE_GRAPHQL_SOUP=true
if [ ! -d node_modules/playwright ]; then nix develop -c bun install --frozen-lockfile; fi
exec nix develop -c just stack up --instance che2e-b --no-doppler --no-computers --traces off \
  --env-file /home/teo/.cache/channels-e2e/stack.env --verbose --json "$@"
