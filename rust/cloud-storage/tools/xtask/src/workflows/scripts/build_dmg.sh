set -euo pipefail
cachix_pid=
if command -v cachix >/dev/null 2>&1 && [ -n "${CACHIX_CACHE_NAME:-}" ]; then
  cachix watch-store "$CACHIX_CACHE_NAME" >/tmp/cachix-watch-store.log 2>&1 &
  cachix_pid=$!
  trap 'if [ -n "${cachix_pid:-}" ]; then kill "$cachix_pid" 2>/dev/null || true; wait "$cachix_pid" 2>/dev/null || true; fi' EXIT
fi
nix build --impure --option sandbox false --print-build-logs ".#packages.aarch64-darwin.tauri-desktop-dmg"
if command -v cachix >/dev/null 2>&1 && [ -n "${CACHIX_CACHE_NAME:-}" ]; then
  cachix push "$CACHIX_CACHE_NAME" result || echo "::warning::Failed to push DMG result closure to Cachix."
fi
