#!/usr/bin/env bash
set -euo pipefail

no_update=false
for arg in "$@"; do
  case "$arg" in
    --no-update) no_update=true ;;
    -h|--help) echo "Usage: just ios-build [--no-update]"; exit 0 ;;
    *) echo "Unknown option: $arg. Usage: just ios-build [--no-update]" >&2; exit 2 ;;
  esac
done
set --
if [[ "$no_update" == true ]]; then
  set -- -- --no-default-features
fi

script_dir="$(\cd "$(dirname "$0")" && pwd)"
\cd "$script_dir/.."

source "$script_dir/ios-native-env.sh"
ios_resolve_toolchain aarch64-apple-ios

# The web/WASM build keeps its original toolchain. Switch to Apple tools only
# for the native build, and skip Tauri's hook because it has already run here.
just build-tauri

ios_activate_toolchain

\cd tauri/src-tauri
exec "$ios_cargo" tauri ios build --open \
  --config '{"build":{"beforeBuildCommand":"","frontendDist":"../../dist"}}' "$@"
