#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack. start.sh is infra-only so cargo-test agents do not
# boot FusionAuth. Cargo, Bun, and BuildKit incrementally reconcile the checked
# out branch against the durable main-build caches before services start.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  ensure_dockerd
  reenter_pinned_nix_shell "${SCRIPT_DIR}/stack.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/start.sh"

cd "${WORKSPACE_ROOT}"
restore_stack_snapshot_image
just stack up --no-doppler --build-aux-services

echo "cursor-cloud stack: app ready"
