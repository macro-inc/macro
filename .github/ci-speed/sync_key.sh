#!/usr/bin/env bash
# Prints a key that changes whenever an input to the sync worker's deployed bundle changes.
# Run from the repository root.
set -euo pipefail
{
  # The worker's workspace closure, including its wrangler config, lockfile and migrations.
  jq -r '.closures.sync_service[]' .github/workspace-dep-closures.json | LC_ALL=C sort | while read -r dir; do
    printf '%s %s\n' "$dir" "$(git rev-parse "HEAD:$dir")"
  done
  # Third-party crates exactly as the worker resolves them, so unrelated Cargo.lock changes don't count.
  cargo tree --locked -p sync_service --target wasm32-unknown-unknown -e normal,build -f '{p} {f}' --prefix none | LC_ALL=C sort -u
  # Build settings that live outside the closure.
  for path in rust-toolchain.toml .cargo/config.toml vendor; do
    if git cat-file -e "HEAD:$path" 2>/dev/null; then printf '%s %s\n' "$path" "$(git rev-parse "HEAD:$path")"; fi
  done
  python3 -I -c 'import tomllib; d = tomllib.load(open("Cargo.toml", "rb")); print(sorted(d.get("profile", {}).items())); print(sorted(d.get("patch", {}).items()))'
} | sed -E 's#\(/[^)]*/(macro|src)/#(#' | sha256sum | cut -d' ' -f1
