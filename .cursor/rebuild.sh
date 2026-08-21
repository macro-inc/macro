#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Backend-edit flow, as one verb: rebuild the Nix stack binaries and recycle
# the stack onto them. This replaces `just stack update`, which cannot write
# into the read-only Nix binaries directory.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/rebuild.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/infra.sh"

\cd "${WORKSPACE_ROOT}"
just stack down
exec /usr/bin/bash "${SCRIPT_DIR}/stack.sh"
