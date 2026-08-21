WORKSPACE_ROOT='/workspace'
CACHE_ROOT="${HOME}/.cache/macro-cloud"
TARGET_CACHE="${CACHE_ROOT}/target"
export MACRO_STACK_SNAPSHOT_DIR="${CACHE_ROOT}/stack-snapshots"

LOG_DIR="${HOME}/.cursor-cloud"
MACRODB_URL='postgres://user:password@localhost:5432/macrodb'
DOCKER_SOCK='/var/run/docker.sock'
DOCKER_IPTABLES_BACKEND='/usr/sbin/iptables-legacy'
DOCKER_IP6TABLES_BACKEND='/usr/sbin/ip6tables-legacy'
NIX_BIN='/nix/var/nix/profiles/default/bin/nix'
NIX_SOCK='/nix/var/nix/daemon-socket/socket'
NIX_CACHE_URL='s3://macro-nix-cache?region=us-east-1&compression=zstd'
NIX_CACHE_PUBLIC_KEY='nix-cache.macro.com-1:UtlRPa6ac+o4IfY+wV8KUS+X0XPU0YMv18lPWEDYN5k='
LOCAL_STACK_BINS="${CACHE_ROOT}/local-stack-bins"
export DATABASE_URL="${MACRODB_URL}"

mkdir -p "${LOG_DIR}" "${TARGET_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"

nix_base_conf() {
  echo 'experimental-features = nix-command flakes'
  echo "trusted-users = root $(id -un)"
  echo 'build-users-group = nixbld'
  echo 'sandbox = false'
}

ensure_nix_installed() {
  if [ -x "${NIX_BIN}" ]; then
    return 0
  fi
  echo "cursor-cloud: installing Determinate Nix"
  local conf_args=()
  local line
  while IFS= read -r line; do
    conf_args+=(--extra-conf "${line}")
  done < <(nix_base_conf)
  curl --retry 5 --retry-delay 2 --retry-all-errors -fsSL \
    https://install.determinate.systems/nix |
    sudo sh -s -- install linux \
      --init none \
      --no-confirm \
      "${conf_args[@]}"
  test -x "${NIX_BIN}"
}

ensure_nix_daemon() {
  ensure_nix_installed

  local cache_enabled=false
  if [ -n "${NIX_CACHE_AWS_ACCESS_KEY_ID:-}" ] \
    && [ -n "${NIX_CACHE_AWS_SECRET_ACCESS_KEY:-}" ]; then
    cache_enabled=true
  fi

  local desired_conf
  desired_conf="$(mktemp)"
  {
    nix_base_conf
    if "${cache_enabled}"; then
      echo "extra-substituters = ${NIX_CACHE_URL}"
      echo "extra-trusted-public-keys = ${NIX_CACHE_PUBLIC_KEY}"
      echo 'narinfo-cache-negative-ttl = 30'
    fi
  } >"${desired_conf}"

  local config_changed=false
  sudo mkdir -p /etc/nix
  if ! sudo cmp -s "${desired_conf}" /etc/nix/nix.conf; then
    sudo install -m 0644 "${desired_conf}" /etc/nix/nix.conf
    sudo pkill -x nix-daemon >/dev/null 2>&1 || true
    config_changed=true
  fi
  rm -f "${desired_conf}"

  if "${config_changed}"; then
    local config_wait=0
    while sudo pgrep -x nix-daemon >/dev/null 2>&1 && [ "${config_wait}" -lt 30 ]; do
      config_wait=$((config_wait + 1))
      sleep 1
    done
  fi

  if "${NIX_BIN}" ping-store >/dev/null 2>&1; then
    return 0
  fi

  # Disk snapshots preserve dead socket entries.
  sudo rm -f "${NIX_SOCK}"
  : >"${LOG_DIR}/nix-daemon.log"
  local daemon_env=()
  if "${cache_enabled}"; then
    # The daemon performs substitution, so it owns the S3 credentials.
    daemon_env+=(
      "AWS_ACCESS_KEY_ID=${NIX_CACHE_AWS_ACCESS_KEY_ID}"
      "AWS_SECRET_ACCESS_KEY=${NIX_CACHE_AWS_SECRET_ACCESS_KEY}"
    )
  fi
  sudo setsid --fork env "${daemon_env[@]}" "${NIX_BIN}" daemon \
    >>"${LOG_DIR}/nix-daemon.log" 2>&1 </dev/null
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
  # Compose puts Postgres/Redis/services on custom bridges. With
  # bridge-nf-call-iptables=1, that ICC walks iptables FORWARD. Dockerd
  # programs the legacy table; if iptables-legacy is missing it only
  # wires docker0, and auth/storage time out reaching postgres.
  if [ ! -x "${DOCKER_IPTABLES_BACKEND}" ] \
    || [ ! -x "${DOCKER_IP6TABLES_BACKEND}" ]; then
    if [ ! -x /usr/bin/apt-get ]; then
      echo "cursor-cloud: iptables-legacy is required for Docker ICC" >&2
      return 1
    fi
    echo "cursor-cloud: installing iptables (legacy backend)"
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables
  fi

  if [ -x /usr/bin/update-alternatives ]; then
    local desired_backend
    desired_backend="$(readlink -f "${DOCKER_IPTABLES_BACKEND}")"
    local desired_ip6_backend
    desired_ip6_backend="$(readlink -f "${DOCKER_IP6TABLES_BACKEND}")"
    local current_backend
    current_backend="$(readlink -f /etc/alternatives/iptables 2>/dev/null || true)"

    if [ "${current_backend}" != "${desired_backend}" ]; then
      sudo /usr/bin/update-alternatives \
        --set iptables "${DOCKER_IPTABLES_BACKEND}"
    fi
    if [ "$(readlink -f /etc/alternatives/ip6tables 2>/dev/null || true)" \
      != "${desired_ip6_backend}" ]; then
      sudo /usr/bin/update-alternatives \
        --set ip6tables "${DOCKER_IP6TABLES_BACKEND}"
    fi
  fi
}

# Allow container-to-container traffic on every Docker bridge. Needed when
# networks were created before iptables-legacy existed (dockerd then only
# programmed docker0). Safe to repeat: each rule is added only if missing.
ensure_docker_bridge_forwarding() {
  if [ ! -x "${DOCKER_IPTABLES_BACKEND}" ]; then
    return 0
  fi
  if ! sudo "${DOCKER_IPTABLES_BACKEND}" -nL DOCKER-FORWARD >/dev/null 2>&1; then
    return 0
  fi

  local br name
  for br in /sys/class/net/br-*; do
    [ -e "${br}" ] || continue
    name="$(basename "${br}")"
    if ! sudo "${DOCKER_IPTABLES_BACKEND}" -C DOCKER-FORWARD \
      -i "${name}" -j ACCEPT >/dev/null 2>&1; then
      sudo "${DOCKER_IPTABLES_BACKEND}" -A DOCKER-FORWARD \
        -i "${name}" -j ACCEPT
    fi
    if sudo "${DOCKER_IPTABLES_BACKEND}" -nL DOCKER-CT >/dev/null 2>&1 \
      && ! sudo "${DOCKER_IPTABLES_BACKEND}" -C DOCKER-CT -o "${name}" \
        -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT >/dev/null 2>&1; then
      sudo "${DOCKER_IPTABLES_BACKEND}" -A DOCKER-CT -o "${name}" \
        -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
    fi
    if sudo "${DOCKER_IPTABLES_BACKEND}" -nL DOCKER-BRIDGE >/dev/null 2>&1 \
      && ! sudo "${DOCKER_IPTABLES_BACKEND}" -C DOCKER-BRIDGE \
        -o "${name}" -j DOCKER >/dev/null 2>&1; then
      sudo "${DOCKER_IPTABLES_BACKEND}" -A DOCKER-BRIDGE \
        -o "${name}" -j DOCKER || true
    fi
  done
}

ensure_dockerd() {
  ensure_docker_iptables_backend

  local dockerd_bin
  if [ -x /usr/bin/dockerd ]; then
    dockerd_bin='/usr/bin/dockerd'
  else
    dockerd_bin="$(command -v dockerd || true)"
  fi
  if [ -z "${dockerd_bin}" ] || [ ! -x "${dockerd_bin}" ]; then
    echo "dockerd not found in /usr/bin or PATH" >&2
    return 1
  fi

  local storage_driver='vfs'
  local storage_args=()
  if command -v fuse-overlayfs >/dev/null 2>&1; then
    storage_driver='fuse-overlayfs'
  fi
  if ! sudo /usr/bin/grep -q '"storage-driver"[[:space:]]*:' /etc/docker/daemon.json 2>/dev/null; then
    storage_args+=("--storage-driver=${storage_driver}")
  fi
  if [ -S "${DOCKER_SOCK}" ]; then
    sudo chmod 666 "${DOCKER_SOCK}"
    if docker info >/dev/null 2>&1; then
      ensure_docker_bridge_forwarding
      return 0
    fi
  fi
  # Disk snapshots preserve dead socket entries.
  sudo rm -f "${DOCKER_SOCK}"
  : >"${LOG_DIR}/dockerd.log"
  sudo setsid --fork env "PATH=${PATH}" "${dockerd_bin}" "${storage_args[@]}" \
    >>"${LOG_DIR}/dockerd.log" 2>&1 </dev/null
  local n=0
  while [ "${n}" -lt 60 ]; do
    if [ -S "${DOCKER_SOCK}" ]; then
      sudo chmod 666 "${DOCKER_SOCK}"
      if docker info >/dev/null 2>&1; then
        ensure_docker_bridge_forwarding
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

ensure_persistent_caches() {
  mkdir -p "${TARGET_CACHE}" "${MACRO_STACK_SNAPSHOT_DIR}"
  remove_workspace_target_mounts

  if [ -e "${WORKSPACE_ROOT}/target" ] && [ ! -L "${WORKSPACE_ROOT}/target" ]; then
    sudo rm -rf "${WORKSPACE_ROOT}/target"
  fi

  mkdir -p "${TARGET_CACHE}"
  ln -sfn "${TARGET_CACHE}" "${WORKSPACE_ROOT}/target"
  if [ "$(stat -c '%U' "${TARGET_CACHE}")" != "$(workspace_owner)" ]; then
    sudo chown -R "$(workspace_owner):$(workspace_group)" "${TARGET_CACHE}"
  fi
  echo "cursor-cloud: ${WORKSPACE_ROOT}/target -> ${TARGET_CACHE}"
}

build_local_stack_binaries() {
  (
    \cd "${WORKSPACE_ROOT}"
    "${NIX_BIN}" build "${WORKSPACE_ROOT}#local-stack-binaries" --out-link "${LOCAL_STACK_BINS}"
  )
}

stop_cloud_daemons() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    local ids
    ids="$(docker ps -aq 2>/dev/null || true)"
    if [ -n "${ids}" ]; then
      # shellcheck disable=SC2086
      timeout --kill-after=5s 45s docker stop -t 5 ${ids} >/dev/null 2>&1 || true
    fi
  fi
  sudo pkill -x dockerd >/dev/null 2>&1 || true
  sudo pkill -x containerd >/dev/null 2>&1 || true
  sudo pkill -x nix-daemon >/dev/null 2>&1 || true
  sudo pkill -x determinate-nixd >/dev/null 2>&1 || true
  local n=0
  while sudo pgrep -x dockerd >/dev/null 2>&1 \
    || sudo pgrep -x nix-daemon >/dev/null 2>&1 \
    || sudo pgrep -x determinate-nixd >/dev/null 2>&1; do
    n=$((n + 1))
    if [ "${n}" -ge 15 ]; then
      sudo pkill -9 -x dockerd >/dev/null 2>&1 || true
      sudo pkill -9 -x containerd >/dev/null 2>&1 || true
      sudo pkill -9 -x nix-daemon >/dev/null 2>&1 || true
      sudo pkill -9 -x determinate-nixd >/dev/null 2>&1 || true
      break
    fi
    sleep 1
  done
}
