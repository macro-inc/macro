#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Backend-edit flow: rebuild Nix stack binaries and adopt them into the
# running stack. Volumes stay. If nothing is recorded yet, `stack update`
# bootstraps through `stack up`.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/rebuild.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/infra.sh"

\cd "${WORKSPACE_ROOT}"
build_local_stack_binaries
stack_doppler_args
just stack update "${doppler_args[@]}" --binaries-dir "${LOCAL_STACK_BINS}/bin"
ensure_docker_bridge_forwarding

echo "cursor-cloud stack: binaries remounted"
