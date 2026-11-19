#!/usr/bin/env bash
# run.sh <port> [playwright args]: run the channels e2e suite from the base worktree against https://localhost:<port>.
# Results land in ~/.cache/channels-e2e/runs/<port>[-$RUN_TAG]/ (playwright-report.json, test-results/). Set RUN_TAG when several runs share a stack.
port=$1; shift
# The stacks built with the flag: main with it (24909) and the local-index branch (30709).
case $port in 24909|30709) export VITE_ENABLE_GRAPHQL_SOUP=true;; *) unset VITE_ENABLE_GRAPHQL_SOUP;; esac
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base/apps/web
export CHANNELS_E2E_STACK_URL=https://localhost:$port
export CHANNELS_E2E_RUN_DIR=$HOME/.cache/channels-e2e/runs/$port${RUN_TAG:+-$RUN_TAG}
mkdir -p "$CHANNELS_E2E_RUN_DIR"
exec nix shell nixpkgs#socat -c nix develop -c ~/.cache/channels-e2e/isolated.sh "$port" \
  env -u LD_LIBRARY_PATH bunx playwright test --config tests/channels-e2e/playwright.config.ts "$@"
