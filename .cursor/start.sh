#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

# Boot path: keep this near-empty so sessions and subagents start instantly.
# On-demand work lives in infra.sh (databases) and stack.sh (product stack).
ensure_nix_daemon
ensure_persistent_caches

echo "cursor-cloud start: ready"
