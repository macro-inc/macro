#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${HOME}/.cursor-cloud"
MACRODB_URL='postgres://user:password@localhost:5432/macrodb'
DOCKER_SOCK='/var/run/docker.sock'
NIX_DAEMON='/nix/var/nix/profiles/default/bin/nix-daemon'

export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"
export DATABASE_URL="${MACRODB_URL}"

mkdir -p "${LOG_DIR}"

ensure_nix_daemon() {
  if nix ping-store >/dev/null 2>&1; then
    return 0
  fi
  sudo setsid "${NIX_DAEMON}" >>"${LOG_DIR}/nix-daemon.log" 2>&1 </dev/null &
  local n=0
  while [ "${n}" -lt 30 ]; do
    if nix ping-store >/dev/null 2>&1; then
      return 0
    fi
    n=$((n + 1))
    sleep 1
  done
  echo "nix-daemon did not become ready" >&2
  return 1
}

ensure_dockerd() {
  if [ ! -S "${DOCKER_SOCK}" ]; then
    sudo setsid /usr/bin/dockerd >>"${LOG_DIR}/dockerd.log" 2>&1 </dev/null &
    local n=0
    while [ "${n}" -lt 60 ]; do
      if [ -S "${DOCKER_SOCK}" ]; then
        break
      fi
      n=$((n + 1))
      sleep 1
    done
  fi
  if [ ! -S "${DOCKER_SOCK}" ]; then
    echo "docker.sock not ready" >&2
    return 1
  fi
  sudo chmod 666 "${DOCKER_SOCK}"
}

ensure_just_sqlx() {
  if command -v just >/dev/null 2>&1 && command -v sqlx >/dev/null 2>&1; then
    return 0
  fi
  nix profile add nixpkgs#just nixpkgs#sqlx-cli
  hash -r
}

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

ensure_apt_packages
ensure_nix_daemon
ensure_just_sqlx
ensure_dockerd

docker pull pgvector/pgvector:pg18
docker pull redis/redis-stack:latest

cd /workspace
just run_dbs -d

ensure_test_envs

just initialize_dbs
cargo fetch --locked
SQLX_OFFLINE=true cargo test --no-run -p macro_db_client

echo "cursor-cloud install: test-ready"
