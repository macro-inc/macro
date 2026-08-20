#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=cloud-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloud-lib.sh"

ensure_apt_packages() {
  local pkg
  local missing=()
  for pkg in libssl-dev pkg-config postgresql-client; do
    if ! dpkg -s "${pkg}" >/dev/null 2>&1; then
      missing+=("${pkg}")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
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

build_app_artifacts() {
  nix develop --command bash -lc "
    set -euo pipefail
    export PATH=\"\${HOME}/.nix-profile/bin:\${PATH}\"
    cargo build -p xtask_local --features local-stack
    cargo run --quiet --manifest-path Cargo.toml -p xtask_local --features local-stack -- zigbuild
    cargo run --quiet --manifest-path Cargo.toml -p xtask_local --features local-stack -- runtime-image
    bun install --frozen-lockfile
    (
      cd apps/web
      MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL VITE_LOCAL_BACKEND_ORIGIN=same-origin \\
        bun run --bun build
    )
  "
  if [ -f /workspace/apps/web/dist/index.html ]; then
    mkdir -p "${FRONTEND_CACHE}"
    cp -a /workspace/apps/web/dist/. "${FRONTEND_CACHE}/"
  fi
}

ensure_apt_packages
ensure_nix_daemon
ensure_just_sqlx
ensure_dockerd
ensure_persistent_caches

docker pull pgvector/pgvector:pg18
docker pull redis/redis-stack:latest

cd /workspace
just run_dbs -d

ensure_test_envs

just initialize_dbs
unset SQLX_OFFLINE
cargo fetch --locked
cargo test --no-run -p macro_db_client

echo "cursor-cloud install: test-ready"

# Do not start the product stack. Aux Dockerfiles rebuild on a missing image
# and have failed this environment with Debian apt 400.
if app_artifacts_ready; then
  echo "cursor-cloud install: app-artifacts cached"
else
  build_app_artifacts
  echo "cursor-cloud install: app-artifacts"
fi
