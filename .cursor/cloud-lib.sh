# Shared by install.sh / start.sh / stack.sh. Sourced, not executed.
# Persistent caches live under $HOME so they survive `git checkout` into /workspace.

CACHE_ROOT="${HOME}/.cache/macro-cloud"
TARGET_CACHE="${CACHE_ROOT}/target"
FRONTEND_CACHE="${CACHE_ROOT}/frontend"
export MACRO_STACK_SNAPSHOT_DIR="${CACHE_ROOT}/stack-snapshots"
export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

LOG_DIR="${HOME}/.cursor-cloud"
MACRODB_URL='postgres://user:password@localhost:5432/macrodb'
DOCKER_SOCK='/var/run/docker.sock'
NIX_DAEMON='/nix/var/nix/profiles/default/bin/nix-daemon'
export DATABASE_URL="${MACRODB_URL}"

mkdir -p "${LOG_DIR}" "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

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

workspace_owner() {
  stat -c '%U' /workspace
}

workspace_group() {
  stat -c '%G' /workspace
}

# Move /workspace/target into $HOME (same filesystem: rename). Recreate the
# symlink after every checkout so cargo and `just stack --no-build` still
# look at the default path.
ensure_persistent_caches() {
  mkdir -p "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

  if [ -e /workspace/target ] && [ ! -L /workspace/target ]; then
    if [ -x /workspace/target/x86_64-unknown-linux-gnu/debug/document_storage_service ] \
      && [ ! -x "${TARGET_CACHE}/x86_64-unknown-linux-gnu/debug/document_storage_service" ]; then
      echo "cursor-cloud: moving /workspace/target -> ${TARGET_CACHE}"
      rm -rf "${TARGET_CACHE}"
      mv /workspace/target "${TARGET_CACHE}"
    else
      echo "cursor-cloud: replacing /workspace/target with cache symlink"
      rm -rf /workspace/target
    fi
  fi

  mkdir -p "${TARGET_CACHE}"
  ln -sfn "${TARGET_CACHE}" /workspace/target
  sudo chown -R "$(workspace_owner):$(workspace_group)" "${TARGET_CACHE}"
  echo "cursor-cloud: /workspace/target -> ${TARGET_CACHE}"

  if [ ! -f /workspace/apps/web/dist/index.html ] && [ -f "${FRONTEND_CACHE}/index.html" ]; then
    mkdir -p /workspace/apps/web/dist
    cp -a "${FRONTEND_CACHE}/." /workspace/apps/web/dist/
    echo "cursor-cloud: restored frontend bundle from cache"
  elif [ -f /workspace/apps/web/dist/index.html ]; then
    cp -a /workspace/apps/web/dist/. "${FRONTEND_CACHE}/"
  fi

  if [ -d /workspace/infra/local/generated/.snapshots ]; then
    cp -a /workspace/infra/local/generated/.snapshots/. "${MACRO_STACK_SNAPSHOT_DIR}/"
  fi
}

required_zig_bins() {
  awk '/cargo_bin: "/ { gsub(/[",]/, "", $2); print $2 }' \
    /workspace/tooling/xtask/crates/xtask_local/src/local/inventory.rs
}

app_artifacts_ready() {
  local dir="/workspace/target/x86_64-unknown-linux-gnu/debug"
  local bin
  while IFS= read -r bin; do
    [ -z "${bin}" ] && continue
    [ -x "${dir}/${bin}" ] || return 1
  done < <(required_zig_bins)
  [ -f /workspace/apps/web/dist/index.html ]
}
