#!/usr/bin/env bash
# Run the channel stability property against a local E2E stack (see README.md).
# Usage: tests/bombadil/run.sh <frontend-url> [extra bombadil test flags...]
set -euo pipefail

BOMBADIL_VERSION=0.7.10
HERE="$(\cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_URL="${1:?usage: run.sh <frontend-url> [bombadil flags...]}"
shift
: "${CHROME:?set CHROME to a Chromium binary that accepts the stack certificate}"
: "${BACKEND_ORIGIN:?set BACKEND_ORIGIN to the stack proxy, e.g. https://localhost:20909}"
: "${PEER_TOKEN:?set PEER_TOKEN to the access token of a second seeded user}"

# local.json holds a token: readable by its owner only, and gitignored.
(
  umask 077
  bun -e 'console.log(JSON.stringify({ backendOrigin: process.env.BACKEND_ORIGIN, frontendOrigin: process.argv[1], peerToken: process.env.PEER_TOKEN }))' \
    "$FRONTEND_URL" > "$HERE/local.json"
)

GENERAL_CHANNEL=$(bun -e 'console.log(require(process.argv[1]).channels.general.id)' \
  "$HERE/../../../../tooling/seed_cli/seed/local_e2e/manifest.json")
OUTPUT="${BOMBADIL_OUTPUT:-$HERE/../../test-results/bombadil/channel-stability}"
mkdir -p "$OUTPUT"

# The cookie is the app's login hint; requests authenticate with the bundle's
# bearer token.
exec bunx "@antithesishq/bombadil@$BOMBADIL_VERSION" browser test \
  --headless \
  --no-sandbox \
  --width 1280 \
  --height 800 \
  --cookie login=true \
  --output-path "$OUTPUT" \
  --output-path-overwrite \
  "$@" \
  "$FRONTEND_URL/app/channel/$GENERAL_CHANNEL" \
  "$HERE/channel-stability.ts"
