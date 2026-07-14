set -euo pipefail
cachix_pid=
if command -v cachix >/dev/null 2>&1 && [ -n "${CACHIX_CACHE_NAME:-}" ]; then
  cachix watch-store "$CACHIX_CACHE_NAME" >/tmp/cachix-watch-store.log 2>&1 &
  cachix_pid=$!
  trap 'if [ -n "${cachix_pid:-}" ]; then kill "$cachix_pid" 2>/dev/null || true; wait "$cachix_pid" 2>/dev/null || true; fi' EXIT
fi
restart_nix_daemon() {
  echo "::warning::Restarting nix-daemon before retrying AppImage build."
  sudo systemctl restart nix-daemon.service 2>/dev/null || true
  sudo pkill -x nix-daemon 2>/dev/null || true
  sudo rm -f /nix/var/nix/daemon-socket/socket
  sudo mkdir -p /nix/var/nix/daemon-socket
  sudo sh -c 'nohup /nix/var/nix/profiles/default/bin/nix-daemon >/tmp/nix-daemon-retry.log 2>&1 &'
  for _ in $(seq 1 30); do
    if sudo test -S /nix/var/nix/daemon-socket/socket; then
      return 0
    fi
    sleep 1
  done
  echo "nix-daemon failed to restart; log follows:" >&2
  sudo cat /tmp/nix-daemon-retry.log >&2 || true
  return 1
}

build_appimage() {
  local attempt="$1"
  local -a fallback_args=()
  if [ "$attempt" -eq 3 ]; then
    fallback_args=(--fallback)
  fi

  # Force a hermetic Nix sandbox for linuxdeploy. Namespace's restored
  # Nix daemon can otherwise run unsandboxed under /nix/var/nix/builds,
  # where linuxdeploy sees host libraries/tools and can fail with only
  # `failed to run linuxdeploy` in Tauri's default output.
  nix build \
    "${fallback_args[@]}" \
    --option sandbox true \
    --option sandbox-build-dir /build \
    --option download-attempts 10 \
    --print-build-logs \
    ".#tauri-desktop-appimage"
}

for attempt in 1 2 3; do
  if build_appimage "$attempt"; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    exit 1
  fi
  echo "::warning::AppImage nix build failed on attempt $attempt; retrying."
  restart_nix_daemon
  sleep $((attempt * 10))
done
if command -v cachix >/dev/null 2>&1 && [ -n "${CACHIX_CACHE_NAME:-}" ]; then
  cachix push "$CACHIX_CACHE_NAME" result || echo "::warning::Failed to push AppImage result closure to Cachix."
fi
