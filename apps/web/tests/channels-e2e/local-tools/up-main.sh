#!/usr/bin/env bash
# Bring up the `che2e-main` headless stack from the channels-e2e-base worktree (main).
set -euo pipefail
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
export TMPDIR=/home/teo/.cache/channels-e2e/tmp
if [ ! -d node_modules/playwright ]; then nix develop -c bun install --frozen-lockfile; fi
exec nix develop -c just stack up --instance che2e-main --no-doppler --no-computers --traces off \
  --env-file /home/teo/.cache/channels-perf/stack.env --verbose --json "$@"
