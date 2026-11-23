#!/usr/bin/env bash
# Prints a key that changes whenever an input to the deployed sync worker changes.
# Run from the repository root. Keep every input to the worker's bundle covered:
# a missing input would let the deploy job skip a worker that did change.
set -euo pipefail

# Hash a finished file, not a pipe: a failure part way through must print no key
# rather than the hash of partial inputs, which could match a later failure.
inputs=$(mktemp)
trap 'rm -f "$inputs"' EXIT

{
  # The worker's workspace closure, which holds its wrangler config, lockfile,
  # build script and D1 migrations.
  jq -r '.closures.sync_service[]' .github/workspace-dep-closures.json |
    LC_ALL=C sort |
    while read -r dir; do
      printf '%s %s\n' "$dir" "$(git rev-parse "HEAD:$dir")"
    done

  # Third-party crates and features as the worker resolves them, so a Cargo.lock
  # change that only affects other packages leaves the key alone. Path crates
  # are dropped here because the closure above already hashes them.
  cargo tree --locked -p sync_service --target wasm32-unknown-unknown \
    -e normal,build -f '{p} {f}' --prefix none |
    sed -E 's/ \(\*\)$//; s# \(/[^)]*\)##' |
    LC_ALL=C sort -u

  # Build settings that live outside the closure.
  for path in rust-toolchain.toml .cargo/config.toml vendor; do
    if git cat-file -e "HEAD:$path" 2>/dev/null; then
      printf '%s %s\n' "$path" "$(git rev-parse "HEAD:$path")"
    fi
  done
  python3 -I -c 'import tomllib
manifest = tomllib.load(open("Cargo.toml", "rb"))
print(sorted(manifest.get("profile", {}).items()))
print(sorted(manifest.get("patch", {}).items()))'
} >"$inputs"

sha256sum "$inputs" | cut -d' ' -f1
