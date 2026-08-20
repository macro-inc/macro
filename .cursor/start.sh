#!/usr/bin/env bash
# Per-boot daemons for Cursor Cloud Agents. There is no systemd (init is tini).
# Idempotent: skip a daemon that is already listening.
set -euo pipefail

NIX_DAEMON="/nix/var/nix/profiles/default/bin/nix-daemon"
NIX_SOCKET="/nix/var/nix/daemon-socket/socket"
DOCKER_SOCK="/var/run/docker.sock"

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

if ! docker info >/dev/null 2>&1; then
  echo "cursor-cloud start: starting dockerd"
  # fuse-overlayfs needs /dev/fuse in nested containers.
  if [ ! -e /dev/fuse ]; then
    sudo mknod /dev/fuse c 10 229 || true
    sudo chmod 666 /dev/fuse || true
  fi
  sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
  : >/tmp/dockerd.log
  sudo dockerd --host=unix:///var/run/docker.sock --pidfile=/var/run/docker.pid \
    >>/tmp/dockerd.log 2>&1 &
fi
if ! wait_for "docker socket" 90 test -S "${DOCKER_SOCK}"; then
  echo "cursor-cloud start: dockerd.log follows" >&2
  sudo cat /tmp/dockerd.log >&2 || true
  ls -la /var/run /run /dev/fuse >&2 || true
  ps -ef >&2 || true
  exit 1
fi
sudo chmod 666 "${DOCKER_SOCK}"
if ! wait_for "docker daemon" 60 docker info; then
  echo "cursor-cloud start: docker info failed; dockerd.log follows" >&2
  sudo cat /tmp/dockerd.log >&2 || true
  exit 1
fi
