#!/usr/bin/env bash
# Bring up the `che2e-main-on` headless stack from the channels-e2e-base worktree (main).
set -euo pipefail
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
export TMPDIR=/home/teo/.cache/channels-e2e/tmp
export VITE_ENABLE_GRAPHQL_SOUP=true
if [ ! -d node_modules/playwright ]; then nix develop -c bun install --frozen-lockfile; fi
exec nix develop -c just stack up --instance che2e-main-on --no-doppler --no-computers --traces off \
  --env-file /home/teo/.cache/channels-e2e/stack.env --verbose --json "$@"
