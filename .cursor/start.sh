#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  ensure_dockerd
  reenter_pinned_nix_shell "${SCRIPT_DIR}/start.sh" "$@"
fi

ensure_persistent_caches

cd "${WORKSPACE_ROOT}"
just run_dbs -d

pg_isready -h 127.0.0.1 -p 5432

echo "cursor-cloud start: infra ready"
