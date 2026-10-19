#!/usr/bin/env bash
# Builds the Tauri frontend into dist once the WASM packages are in place, then
# rejects a bundle that would break at runtime. `just build-tauri`,
# `just build-tauri-dev` and the Nix desktop release (nix/tauri-desktop.nix)
# all run this, so the shipped bundle does not depend on which one built it.
#
# usage: build-tauri-frontend.sh <production|development>
set -euo pipefail

mode="$1"
cd "$(dirname "$0")/.."

# The public build-time env for this mode (build-env.json), which the generated
# web build workflow reads too. A value already in the environment wins, so a
# build can point telemetry elsewhere. Secrets such as VITE_POSTHOG_API_KEY
# still come from the caller's environment.
while IFS='=' read -r name value; do
  export "$name=${!name:-$value}"
done < <(MODE="$mode" bun -e '
  for (const [name, value] of Object.entries(require("./build-env.json")[process.env.MODE])) {
    console.log(`${name}=${value}`);
  }
')

printf '%s' "$mode" > tauri/src-tauri/.macro-tauri-env
# Vite's chunk rendering can exceed 6GB as the app grows.
MODE="$mode" NODE_ENV=production NODE_OPTIONS="--max-old-space-size=8192" bun run --bun build
bun scripts/cache-wasm/cli.ts package-dist --dist dist
bun scripts/cache-wasm/cli.ts remove-sidecar --dist dist
bun scripts/verify-tauri-bundle.ts --dist dist --mode "$mode"
