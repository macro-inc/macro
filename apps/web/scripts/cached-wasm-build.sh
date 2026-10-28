#!/usr/bin/env bash
# Runs a wasm package build, or restores its output from WASM_PKG_CACHE_DIR when
# nothing the package is built from has changed. Without WASM_PKG_CACHE_DIR it
# only runs the build, so local `just build-*` behaves as before.
#
# The cache key hashes the contents of the crate's workspace dependency closure
# (.github/workspace-dep-closures.json), the root manifests and lockfile, the
# toolchain pins, the shared assets build scripts read, and the build command.
#
# usage: cached-wasm-build.sh <closure package> <out dir> -- <build command...>
set -euo pipefail

package="$1"
out_dir="$2"
shift 2
if [ "${1:-}" = "--" ]; then
  shift
fi

if [ -z "${WASM_PKG_CACHE_DIR:-}" ]; then
  exec "$@"
fi

root="$(git rev-parse --show-toplevel)"
mapfile -t dirs < <(jq -r --arg p "$package" '.closures[$p] // empty | .[]' \
  "$root/.github/workspace-dep-closures.json")
if [ "${#dirs[@]}" -eq 0 ]; then
  echo "no dependency closure for $package; building without the cache" >&2
  exec "$@"
fi

key="$(
  {
    (cd "$root" && git ls-files -z -- "${dirs[@]}" Cargo.toml Cargo.lock \
      rust-toolchain.toml flake.lock .cargo static_assets | xargs -0 sha256sum)
    printf '%s\n' "$@"
  } | sha256sum | cut -c1-32
)"
entry="$WASM_PKG_CACHE_DIR/$package-$key"

if [ -d "$entry" ]; then
  echo "$package: unchanged inputs, reusing the cached wasm package ($key)"
  rm -rf "$out_dir"
  mkdir -p "$(dirname "$out_dir")"
  cp -a "$entry" "$out_dir"
  touch "$entry"
  exit 0
fi

"$@"

mkdir -p "$WASM_PKG_CACHE_DIR"
# Entries are small and keyed by content; drop ones no build has used for a week.
find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + || true
tmp="$(mktemp -d "$WASM_PKG_CACHE_DIR/.tmp-XXXXXX")"
cp -a "$out_dir/." "$tmp/"
# A concurrent job may have stored the same key first; keep that one.
mv -T "$tmp" "$entry" 2>/dev/null || rm -rf "$tmp"
