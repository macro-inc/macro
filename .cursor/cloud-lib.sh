# Shared by install.sh / start.sh / stack.sh. Sourced, not executed.
# Persistent caches live under $HOME so they survive `git checkout` into /workspace.

WORKSPACE_ROOT='/workspace'
CACHE_ROOT="${HOME}/.cache/macro-cloud"
TARGET_CACHE="${CACHE_ROOT}/target"
FRONTEND_CACHE="${CACHE_ROOT}/frontend"
export MACRO_STACK_SNAPSHOT_DIR="${CACHE_ROOT}/stack-snapshots"
STACK_SNAPSHOT_IMAGE='macro-cloud-stack-snapshot:prepared'

LOG_DIR="${HOME}/.cursor-cloud"
MACRODB_URL='postgres://user:password@localhost:5432/macrodb'
DOCKER_SOCK='/var/run/docker.sock'
DOCKER_IPTABLES_BACKEND='/usr/sbin/iptables-legacy'
DOCKER_IP6TABLES_BACKEND='/usr/sbin/ip6tables-legacy'
NIX_BIN='/nix/var/nix/profiles/default/bin/nix'
NIX_SOCK='/nix/var/nix/daemon-socket/socket'
export DATABASE_URL="${MACRODB_URL}"

mkdir -p "${LOG_DIR}" "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

ensure_nix_installed() {
  if [ -x "${NIX_BIN}" ]; then
    return 0
  fi
  echo "cursor-cloud: installing Determinate Nix"
  curl --retry 5 --retry-delay 2 --retry-all-errors -fsSL \
    https://install.determinate.systems/nix |
    sudo sh -s -- install linux \
      --init none \
      --no-confirm \
      --extra-conf "trusted-users = root $(id -un)" \
      --extra-conf "sandbox = false"
  test -x "${NIX_BIN}"
}

ensure_nix_daemon() {
  ensure_nix_installed
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

ensure_docker_iptables_backend() {
  local desired_backend
  desired_backend="$(readlink -f "${DOCKER_IPTABLES_BACKEND}")"
  local desired_ip6_backend
  desired_ip6_backend="$(readlink -f "${DOCKER_IP6TABLES_BACKEND}")"
  local current_backend
  current_backend="$(readlink -f /etc/alternatives/iptables 2>/dev/null || true)"

  test -x "${DOCKER_IPTABLES_BACKEND}"
  test -x "${DOCKER_IP6TABLES_BACKEND}"

  # The cloud image can preserve a legacy FORWARD DROP policy while apt selects
  # iptables-nft. Make Docker program the enforcing legacy table instead of
  # opening FORWARD or bypassing Docker's per-network isolation chains.
  if [ "${current_backend}" != "${desired_backend}" ]; then
    sudo /usr/bin/update-alternatives \
      --set iptables "${DOCKER_IPTABLES_BACKEND}"
  fi
  if [ "$(readlink -f /etc/alternatives/ip6tables 2>/dev/null || true)" \
    != "${desired_ip6_backend}" ]; then
    sudo /usr/bin/update-alternatives \
      --set ip6tables "${DOCKER_IP6TABLES_BACKEND}"
  fi

  current_backend="$(readlink -f /etc/alternatives/iptables)"
  local current_ip6_backend
  current_ip6_backend="$(readlink -f /etc/alternatives/ip6tables)"
  test "${current_backend}" = "${desired_backend}"
  test "${current_ip6_backend}" = "${desired_ip6_backend}"
}

ensure_dockerd() {
  ensure_docker_iptables_backend
  local storage_driver='vfs'
  local storage_args=()
  if [ -x /usr/bin/fuse-overlayfs ]; then
    storage_driver='fuse-overlayfs'
  fi
  if ! sudo /usr/bin/grep -q '"storage-driver"[[:space:]]*:' /etc/docker/daemon.json 2>/dev/null; then
    storage_args+=("--storage-driver=${storage_driver}")
  fi
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
  sudo setsid /usr/bin/dockerd "${storage_args[@]}" \
    >>"${LOG_DIR}/dockerd.log" 2>&1 </dev/null &
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

remove_workspace_target_mounts() {
  command -v docker >/dev/null 2>&1 || return 0
  docker info >/dev/null 2>&1 || return 0
  local id source
  for id in $(docker ps -aq); do
    while IFS= read -r source; do
      case "${source}" in
        "${WORKSPACE_ROOT}/target" | "${WORKSPACE_ROOT}/target"/*)
          echo "cursor-cloud: removing leftover container ${id} mounted on ${source}"
          docker rm -f "${id}" >/dev/null 2>&1 || true
          break
          ;;
      esac
    done < <(docker inspect --format '{{range .Mounts}}{{.Source}}{{println}}{{end}}' "${id}")
  done
}

# Move /workspace/target into $HOME (same filesystem: rename). Recreate the
# symlink after every checkout so Cargo's incremental cache survives it.
ensure_persistent_caches() {
  mkdir -p "${TARGET_CACHE}" "${FRONTEND_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"
  remove_workspace_target_mounts

  if [ -e "${WORKSPACE_ROOT}/target" ] && [ ! -L "${WORKSPACE_ROOT}/target" ]; then
    sudo chown -R "$(workspace_owner):$(workspace_group)" "${WORKSPACE_ROOT}/target"
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

bake_stack_snapshot_image() {
  local key="$1"
  local snapshot_dir="$2"

  test -f "${snapshot_dir}/manifest.json"
  docker build \
    --tag "${STACK_SNAPSHOT_IMAGE}" \
    --file - \
    "${snapshot_dir}" <<EOF
FROM alpine:3
LABEL com.macro.stack-snapshot-key="${key}"
COPY . /snapshot/
EOF
  docker image inspect "${STACK_SNAPSHOT_IMAGE}" >/dev/null
}

restore_stack_snapshot_image() {
  if ! docker image inspect "${STACK_SNAPSHOT_IMAGE}" >/dev/null 2>&1; then
    echo "cursor-cloud: prepared stack snapshot image not found"
    return 0
  fi

  local key
  key="$(docker image inspect \
    --format '{{ index .Config.Labels "com.macro.stack-snapshot-key" }}' \
    "${STACK_SNAPSHOT_IMAGE}")"
  case "${key}" in
    ''|*[!0-9a-f]*)
      echo "prepared stack snapshot image has invalid key: ${key}" >&2
      return 1
      ;;
  esac

  local destination="${MACRO_STACK_SNAPSHOT_DIR}/${key}"
  mkdir -p "${destination}"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --volume "${destination}:/restore" \
    "${STACK_SNAPSHOT_IMAGE}" \
    sh -ceu 'cp -R /snapshot/. /restore/'
  test -f "${destination}/manifest.json"
  echo "cursor-cloud: restored stack snapshot ${key} from image"
}
