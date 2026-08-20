#!/usr/bin/env bash
# Per-boot daemons for Cursor Cloud Agents. There is no systemd (init is tini).
# Idempotent: skip a daemon that is already listening.
set -euo pipefail

NIX_DAEMON="/nix/var/nix/profiles/default/bin/nix-daemon"
NIX_SOCKET="/nix/var/nix/daemon-socket/socket"

if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
  # shellcheck disable=SC1091
  . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
fi
export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

wait_for() {
  local desc="$1"
  local tries="$2"
  shift 2
  local i
  for i in $(seq 1 "${tries}"); do
    if "$@" >/dev/null 2>&1; then
      echo "cursor-cloud start: ${desc} ready"
      return 0
    fi
    sleep 1
  done
  echo "cursor-cloud start: timed out waiting for ${desc}" >&2
  return 1
}

if [ ! -S "${NIX_SOCKET}" ]; then
  echo "cursor-cloud start: starting nix-daemon"
  sudo "${NIX_DAEMON}" >>/tmp/nix-daemon.log 2>&1 &
fi
wait_for "nix-daemon" 30 test -S "${NIX_SOCKET}"

if ! sudo docker info >/dev/null 2>&1; then
  echo "cursor-cloud start: starting dockerd"
  # fuse-overlayfs needs /dev/fuse in nested containers.
  if [ ! -e /dev/fuse ]; then
    sudo mknod /dev/fuse c 10 229 || true
    sudo chmod 666 /dev/fuse || true
  fi
  sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  : >/tmp/dockerd.log
  # setsid+nohup: `sudo dockerd &` can get SIGHUP and exit after "daemon started"
  # while never leaving a stable docker.sock for the waiter.
  sudo setsid nohup dockerd \
    --host=unix:///var/run/docker.sock \
    --pidfile=/run/docker.pid \
    >>/tmp/dockerd.log 2>&1 < /dev/null &
fi
if ! wait_for "docker daemon" 90 sudo docker info; then
  echo "cursor-cloud start: dockerd.log follows" >&2
  sudo tail -n 80 /tmp/dockerd.log >&2 || true
  echo "cursor-cloud start: socket listing" >&2
  ls -la /var/run/docker.sock /run/docker.sock /dev/fuse >&2 || true
  echo "cursor-cloud start: docker processes" >&2
  ps -ef | grep -E '[d]ockerd|[c]ontainerd' >&2 || true
  exit 1
fi
# Group membership from the image does not apply until a new login. Always
# chmod as root (do not `test -S` as ubuntu first — a 0600 root socket is
# invisible to that check in some setups) so the ubuntu user can docker(1)
# without sudo.
sudo sh -c 'chmod 666 /var/run/docker.sock /run/docker.sock 2>/dev/null || true'
ls -la /var/run/docker.sock /run/docker.sock || true
if ! wait_for "docker as ubuntu" 15 docker info; then
  echo "cursor-cloud start: ubuntu docker info failed after chmod" >&2
  ls -la /var/run/docker.sock /run/docker.sock >&2 || true
  id >&2
  exit 1
fi
