# Shared by install.sh / start.sh / stack.sh. Sourced, not executed.
# Persistent caches live under $HOME so they survive `git checkout` into /workspace.

WORKSPACE_ROOT='/workspace'
CACHE_ROOT="${HOME}/.cache/macro-cloud"
TARGET_CACHE="${CACHE_ROOT}/target"
FRONTEND_CACHE="${CACHE_ROOT}/frontend"
export MACRO_STACK_SNAPSHOT_DIR="${CACHE_ROOT}/stack-snapshots"

LOG_DIR="${HOME}/.cursor-cloud"
MACRODB_URL='postgres://user:password@localhost:5432/macrodb'
DOCKER_SOCK='/var/run/docker.sock'
NIX_BIN='/nix/var/nix/profiles/default/bin/nix'
NIX_SOCK='/nix/var/nix/daemon-socket/socket'
export DATABASE_URL="${MACRODB_URL}"

mkdir -p "${LOG_DIR}" "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

ensure_nix_daemon() {
  if "${NIX_BIN}" ping-store >/dev/null 2>&1; then
    return 0
  fi
  # Disk snapshots preserve socket path entries, not the process listening on
  # them. Remove the stale entry only after a real store probe has failed.
  sudo rm -f "${NIX_SOCK}"
  : >"${LOG_DIR}/nix-daemon.log"
  sudo setsid "${NIX_BIN}" daemon >>"${LOG_DIR}/nix-daemon.log" 2>&1 </dev/null &
  local n=0
  while [ "${n}" -lt 30 ]; do
    if "${NIX_BIN}" ping-store >/dev/null 2>&1; then
      return 0
    fi
    n=$((n + 1))
    sleep 1
  done
  echo "nix-daemon did not become ready" >&2
  sed -n '1,160p' "${LOG_DIR}/nix-daemon.log" >&2 || true
  return 1
}

ensure_dockerd() {
  if [ -S "${DOCKER_SOCK}" ]; then
    sudo chmod 666 "${DOCKER_SOCK}"
    if docker info >/dev/null 2>&1; then
      return 0
    fi
  fi
  # As with Nix, a snapshot can contain a dead Unix socket. Docker does not
  # reliably replace it while starting, so clear it after the API probe fails.
  sudo rm -f "${DOCKER_SOCK}"
  : >"${LOG_DIR}/dockerd.log"
  sudo setsid /usr/bin/dockerd >>"${LOG_DIR}/dockerd.log" 2>&1 </dev/null &
  local n=0
  while [ "${n}" -lt 60 ]; do
    if [ -S "${DOCKER_SOCK}" ]; then
      sudo chmod 666 "${DOCKER_SOCK}"
      if docker info >/dev/null 2>&1; then
        return 0
      fi
    fi
    n=$((n + 1))
    sleep 1
  done
  echo "dockerd did not become ready" >&2
  sed -n '1,160p' "${LOG_DIR}/dockerd.log" >&2 || true
  return 1
}

in_pinned_nix_shell() {
  [ "${MACRO_CLOUD_PINNED_NIX:-}" = "1" ]
}

reenter_pinned_nix_shell() {
  local script_path="$1"
  shift
  exec "${NIX_BIN}" develop "${WORKSPACE_ROOT}" --command /usr/bin/env \
    MACRO_CLOUD_PINNED_NIX=1 /usr/bin/bash "${script_path}" "$@"
}

workspace_owner() {
  stat -c '%U' "${WORKSPACE_ROOT}"
}

workspace_group() {
  stat -c '%G' "${WORKSPACE_ROOT}"
}

# Move /workspace/target into $HOME (same filesystem: rename). Recreate the
# symlink after every checkout so Cargo's incremental cache survives it.
ensure_persistent_caches() {
  mkdir -p "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

  if [ -e "${WORKSPACE_ROOT}/target" ] && [ ! -L "${WORKSPACE_ROOT}/target" ]; then
    if [ -x "${WORKSPACE_ROOT}/target/x86_64-unknown-linux-gnu/debug/document_storage_service" ] \
      && [ ! -x "${TARGET_CACHE}/x86_64-unknown-linux-gnu/debug/document_storage_service" ]; then
      echo "cursor-cloud: moving ${WORKSPACE_ROOT}/target -> ${TARGET_CACHE}"
      rm -rf "${TARGET_CACHE}"
      mv "${WORKSPACE_ROOT}/target" "${TARGET_CACHE}"
    else
      echo "cursor-cloud: replacing ${WORKSPACE_ROOT}/target with cache symlink"
      rm -rf "${WORKSPACE_ROOT}/target"
    fi
  fi

  mkdir -p "${TARGET_CACHE}"
  ln -sfn "${TARGET_CACHE}" "${WORKSPACE_ROOT}/target"
  sudo chown -R "$(workspace_owner):$(workspace_group)" "${TARGET_CACHE}"
  echo "cursor-cloud: ${WORKSPACE_ROOT}/target -> ${TARGET_CACHE}"

  if [ ! -f "${WORKSPACE_ROOT}/apps/web/dist/index.html" ] && [ -f "${FRONTEND_CACHE}/index.html" ]; then
    mkdir -p "${WORKSPACE_ROOT}/apps/web/dist"
    cp -a "${FRONTEND_CACHE}/." "${WORKSPACE_ROOT}/apps/web/dist/"
    echo "cursor-cloud: restored frontend bundle from cache"
  elif [ -f "${WORKSPACE_ROOT}/apps/web/dist/index.html" ]; then
    cp -a "${WORKSPACE_ROOT}/apps/web/dist/." "${FRONTEND_CACHE}/"
  fi

  if [ -d "${WORKSPACE_ROOT}/infra/local/generated/.snapshots" ]; then
    cp -a "${WORKSPACE_ROOT}/infra/local/generated/.snapshots/." "${MACRO_STACK_SNAPSHOT_DIR}/"
  fi
}
