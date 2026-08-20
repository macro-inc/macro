#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack. start.sh is infra-only so cargo-test agents do not
# boot FusionAuth. Binaries come from $HOME/.cache/macro-cloud (survives
# checkout). --no-build skips zigbuild. Do not pass --build-aux-services.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  ensure_dockerd
  reenter_pinned_nix_shell "${SCRIPT_DIR}/stack.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/start.sh"

cd "${WORKSPACE_ROOT}"
just stack up --no-doppler --no-build

echo "cursor-cloud stack: app ready"
