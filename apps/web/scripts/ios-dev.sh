#!/usr/bin/env bash
set -euo pipefail

script_dir="$(\cd "$(dirname "$0")" && pwd)"
\cd "$script_dir/.."
source "$script_dir/ios-native-env.sh"
ios_resolve_toolchain aarch64-apple-ios-sim

# WASM preparation needs the original Nix environment. Tauri owns the Vite
# process through beforeDevCommand, so it still stops with the dev session.
bun run dev:prepare
ios_activate_toolchain
export PORT="${PORT:-3000}"

\cd tauri/src-tauri
exec "$ios_cargo" tauri ios dev --open \
  --config "{\"build\":{\"devUrl\":\"http://localhost:${PORT}\",\"beforeDevCommand\":{\"script\":\"just dev-tauri-prepared\",\"cwd\":\"../..\"}}}" \
  -- --no-default-features
