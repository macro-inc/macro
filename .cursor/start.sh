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

# Nested dockerd / leftover zigbuild can leave root-owned target/.
ensure_writable_target() {
  if [ -e /workspace/target ] && [ ! -w /workspace/target ]; then
    sudo chown -R "$(id -u):$(id -g)" /workspace/target
  fi
}

ensure_nix_daemon
ensure_dockerd
ensure_just_sqlx
ensure_writable_target

cd /workspace
just run_dbs -d

if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432
else
  timeout 5 bash -c 'echo >/dev/tcp/127.0.0.1/5432'
fi

echo "cursor-cloud start: infra ready"
