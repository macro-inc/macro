#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

crate_env_paths() {
  awk '
    $0 == "setup_test_envs:" { p = 1; next }
    p && /^[A-Za-z_]/ { exit }
    p && />>/ {
      sub(/^.*>>[[:space:]]*/, "")
      print
    }
  ' /workspace/tooling/just/rust.just
}

ensure_test_envs() {
  local f
  while IFS= read -r f; do
    [ -z "${f}" ] && continue
    mkdir -p "$(dirname "${f}")"
    if [ -f "${f}" ] && grep -qxF "DATABASE_URL=${MACRODB_URL}" "${f}"; then
      continue
    fi
    printf 'DATABASE_URL=%s\n' "${MACRODB_URL}" >>"${f}"
  done < <(crate_env_paths)
}

cleanup_stack() {
  \cd "${WORKSPACE_ROOT}"
  timeout --kill-after=10s 2m just --quiet stack down
}

cleanup_stack_best_effort() {
  cleanup_stack >/dev/null 2>&1 || true
}

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/install.sh" "$@"
fi

ensure_dockerd
ensure_persistent_caches

\cd "${WORKSPACE_ROOT}"
just run_dbs -d
trap cleanup_stack_best_effort EXIT

ensure_test_envs

just initialize_dbs
cargo fetch --locked
unset SQLX_OFFLINE
cargo test --no-run -p macro_db_client

echo "cursor-cloud install: test-ready"

bun install --frozen-lockfile
echo "cursor-cloud install: bun cache ready"

build_local_stack_binaries
echo "cursor-cloud install: local stack binaries ready"

just stack up --infra-only --no-doppler --build-aux-services --binaries-dir "${LOCAL_STACK_BINS}/bin" --json
cleanup_stack
trap - EXIT

echo "cursor-cloud install: durable stack ready"
