#!/usr/bin/env bash
# run.sh [playwright args]: run the channels e2e suite from the e2e-b worktree against my instance che2e-bx.
# Results: ~/.cache/channels-e2e-b/runs/${RUN_TAG:-main}/. FLAG=off for a bundle built without the flag.

d=$HOME/.cache/channels-e2e-b
port=24909

if [ "${FLAG:-on}" = on ]; then export VITE_ENABLE_GRAPHQL_SOUP=true; else unset VITE_ENABLE_GRAPHQL_SOUP; fi
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web
export CHANNELS_E2E_STACK_URL=https://localhost:$port
export CHANNELS_E2E_RUN_DIR=$d/runs/${RUN_TAG:-main}
mkdir -p "$CHANNELS_E2E_RUN_DIR"
exec nix shell nixpkgs#socat -c nix develop -c ~/.cache/channels-e2e/isolated.sh "$port" \
  env -u LD_LIBRARY_PATH bunx playwright test --config tests/channels-e2e/playwright.config.ts "$@"
