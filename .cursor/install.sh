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

# Bake the init snapshot on stubs. Runtime stack.sh pulls Doppler when
# DOPPLER_TOKEN is present; secrets must not land in the durable snapshot.
# The bridge watcher mirrors stack.sh: compose creates the stack networks
# mid-`up`, and a bridge born after the iptables pass has no FORWARD accept
# rules — FusionAuth then cannot reach Postgres and wedges in maintenance
# mode, failing the strict-200 kickstart wait.
run_with_bridge_forwarding \
  just stack up --infra-only --no-doppler --build-aux-services --binaries-dir "${LOCAL_STACK_BINS}/bin" --json
ensure_docker_bridge_forwarding
cleanup_stack
trap - EXIT

# Cursor waits for the install process tree to drain. Images, volumes, and
# the Nix store stay on disk; start.sh / infra.sh bring the daemons back.
stop_cloud_daemons

echo "cursor-cloud install: durable stack ready"
