#!/usr/bin/env bash
# suite.sh <tag> [playwright args]: the channels e2e suite (unchanged, from my own checkout of the base-suite
# branch) against the chb-fix stack. Results in ~/.cache/channels-perf-b/e2e/<tag>/.
tag=$1; shift
port=$(jq -r .proxy_url /home/teo/.cache/channels-perf-b/fix-status.json | sed 's/.*://')
export VITE_ENABLE_GRAPHQL_SOUP=true TMPDIR=/home/teo/.cache/channels-perf-b/tmp
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync-suiteb/apps/web
export CHANNELS_E2E_STACK_URL=https://localhost:$port
export CHANNELS_E2E_RUN_DIR=$HOME/.cache/channels-perf-b/e2eb/$tag
mkdir -p "$CHANNELS_E2E_RUN_DIR"
exec nix shell nixpkgs#socat -c nix develop -c /home/teo/.cache/channels-perf-b/isolated.sh "$port" \
  env -u LD_LIBRARY_PATH bunx playwright test --config tests/channels-e2e/playwright.config.ts "$@"
