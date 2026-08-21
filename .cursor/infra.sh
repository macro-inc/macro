#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand infra: dockerd, then Postgres and Redis. Run this before
# DB-backed `cargo test`; boot (start.sh) deliberately starts nothing.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/infra.sh" "$@"
fi

ensure_dockerd
ensure_persistent_caches

\cd "${WORKSPACE_ROOT}"
just run_dbs -d
ensure_docker_bridge_forwarding

pg_isready -h 127.0.0.1 -p 5432

echo "cursor-cloud infra: ready"
