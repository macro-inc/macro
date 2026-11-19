#!/usr/bin/env bash
# Bring up the `channels` headless stack (traces ON -> shared LGTM) from the synoet-channels worktree.
set -euo pipefail
cd /home/teo/.herdr/worktrees/macro/synoet-channels
export TMPDIR=/home/teo/.cache/channels-perf/tmp
mkdir -p "$TMPDIR"
export VITE_ENABLE_GRAPHQL_SOUP=true
if [ ! -d node_modules/playwright ]; then nix develop -c bun install --frozen-lockfile; fi
exec nix develop -c just stack up --instance channels --no-doppler \
  --env-file /home/teo/.cache/channels-perf/stack.env --verbose --json "$@"
