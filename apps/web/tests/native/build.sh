#!/usr/bin/env bash
# Run from any directory inside `nix develop .#tauri-e2e`.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
web="$root/apps/web"
out="$web/tauri/target/e2e"
mkdir -p "$out"

# Pin the upstream driver; never replace the developer's globally installed one.
if ! test -x "$out/tools/bin/tauri-driver"; then
  cargo install tauri-driver --version 2.0.5 --locked --root "$out/tools"
fi

\cd "$web"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$out/prepare-target}"
just ensure-cache-wasm
just ensure-agent-fold-wasm

# build.rs reads this ignored file. Restore it even if compilation fails.
env_file="$web/tauri/src-tauri/.macro-tauri-env"
backup=$(mktemp)
had_env=false
if test -f "$env_file"; then cp "$env_file" "$backup"; had_env=true; fi
restore() {
  if "$had_env"; then cp "$backup" "$env_file"; else rm -f "$env_file"; fi
  rm -f "$backup"
}
trap restore EXIT
printf development > "$env_file"
export TAURI_CONFIG
TAURI_CONFIG=$(< "$web/tests/native/tauri.e2e.conf.json")
export CARGO_TARGET_DIR="$out/cargo"
\cd "$web/tauri/src-tauri"
# Dev-protocol binary: Vite serves the real UI. No production bundle or OTA.
cargo build --locked -p app --no-default-features
cp "$CARGO_TARGET_DIR/debug/app" "$out/app"
echo "Built isolated E2E application: $out/app"
