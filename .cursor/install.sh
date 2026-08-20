#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

ensure_apt_packages() {
  local pkg
  local missing=()
  for pkg in fuse-overlayfs libssl-dev pkg-config postgresql-client; do
    if ! dpkg -s "${pkg}" >/dev/null 2>&1; then
      missing+=("${pkg}")
    fi
  done
  # Do not replace Docker CE on bases that already provide a complete engine.
  if [ ! -x /usr/bin/docker ] || [ ! -x /usr/bin/dockerd ]; then
    missing+=(docker.io docker-buildx docker-compose-v2)
  fi
  if [ "${#missing[@]}" -ne 0 ]; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      -o Dpkg::Options::=--force-confdef \
      -o Dpkg::Options::=--force-confold \
      "${missing[@]}"
  fi
  test -x /usr/bin/dockerd
  /usr/bin/docker buildx version
  /usr/bin/docker compose version
}

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

# setup_test_envs always appends; write each DATABASE_URL at most once.
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

build_frontend_artifact() {
  bun install --frozen-lockfile
  (
    cd "${WORKSPACE_ROOT}/apps/web"
    MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin \
      bun run --bun build
  )
  test -f "${WORKSPACE_ROOT}/apps/web/dist/index.html"
  mkdir -p "${FRONTEND_CACHE}"
  cp -a "${WORKSPACE_ROOT}/apps/web/dist/." "${FRONTEND_CACHE}/"
}

cleanup_stack() {
  cd "${WORKSPACE_ROOT}"
  timeout --kill-after=10s 2m just --quiet stack down
}

cleanup_stack_best_effort() {
  cleanup_stack >/dev/null 2>&1 || true
}

prepare_durable_stack() {
  # `infra-only` is the existing finite CI bake mode: it materializes every
  # Compose image, initializes the real infra, and saves/restores the
  # content-addressed volume snapshot without starting secret-dependent apps.
  just stack up \
    --infra-only \
    --no-doppler \
    --build-aux-services \
    --json

  local snapshot_json
  snapshot_json="$(
    cargo run --quiet --manifest-path Cargo.toml -p xtask_local --features local-stack -- \
      stack snapshot --json
  )"
  local snapshot_fields=()
  mapfile -t snapshot_fields < <(python3 -c '
import json
import sys

snapshot = json.load(sys.stdin)
key = snapshot["key"]
if not snapshot["present"]:
    raise SystemExit(f"stack snapshot missing for key {key}")
print(key)
print(snapshot["dir"])
' <<<"${snapshot_json}")
  local snapshot_key="${snapshot_fields[0]}"
  local snapshot_dir="${snapshot_fields[1]}"

  bake_stack_snapshot_image "${snapshot_key}" "${snapshot_dir}"
  local image_id
  image_id="$(docker image inspect --format '{{.Id}}' "${STACK_SNAPSHOT_IMAGE}")"

  echo "cursor-cloud install: stack snapshot ${snapshot_key} at ${snapshot_dir}"
  echo "cursor-cloud install: stack snapshot image ${STACK_SNAPSHOT_IMAGE} (${image_id})"
}

if ! in_pinned_nix_shell; then
  ensure_apt_packages
  ensure_nix_daemon
  ensure_dockerd
  reenter_pinned_nix_shell "${SCRIPT_DIR}/install.sh" "$@"
fi

ensure_persistent_caches

docker pull pgvector/pgvector:pg18
docker pull redis/redis-stack:latest

cd "${WORKSPACE_ROOT}"
just run_dbs -d
trap cleanup_stack_best_effort EXIT

ensure_test_envs

just initialize_dbs
cargo fetch --locked
unset SQLX_OFFLINE
cargo test --no-run -p macro_db_client

echo "cursor-cloud install: test-ready"

# Build tools own cache validity: Bun, Cargo, and BuildKit compare the current
# source/lock/toolchain inputs instead of trusting surviving files or image tags.
build_frontend_artifact
echo "cursor-cloud install: frontend artifact"

# The bake primitive builds the runtime image and complete Rust binary inventory
# before initializing and snapshotting infra.
prepare_durable_stack
cleanup_stack
trap - EXIT

echo "cursor-cloud install: durable stack ready"
