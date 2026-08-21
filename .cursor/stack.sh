#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack. Boot (start.sh) starts nothing; infra.sh brings up
# dockerd and the databases first. After backend edits, run rebuild.sh.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/stack.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/infra.sh"

\cd "${WORKSPACE_ROOT}"
build_local_stack_binaries
just stack up --no-doppler --build-aux-services --binaries-dir "${LOCAL_STACK_BINS}/bin"

echo "cursor-cloud stack: app ready"
