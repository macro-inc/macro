#!/usr/bin/env bash
# Runs a wasm package build, or restores its output when nothing the package is
# built from has changed: first from WASM_PKG_CACHE_DIR on the node's cache
# volume, then from Namespace's HTTP cache, which every node reads. Without
# WASM_PKG_CACHE_DIR it only runs the build, so local `just build-*` behaves as
# before. Only PR check jobs set it; deploys always build.
#
# wasm-cache-key.ts computes the key from the package's workspace dependency
# closure (.github/workspace-dep-closures.json), its slice of Cargo.lock, the
# root manifest, the toolchain and Nix definitions, the shared assets build
# scripts read, its profile's env and the build command.
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

key="$(bun "$(dirname "$0")/wasm-cache-key.ts" "$package" -- "$@")"
entry="$WASM_PKG_CACHE_DIR/$package-$key"

restore() {
  rm -rf "$out_dir"
  mkdir -p "$(dirname "$out_dir")"
  cp -a "$1" "$out_dir"
}

# Keeps a copy on this node's volume. A concurrent job may have stored the same
# key first; that copy wins.
store_locally() {
  mkdir -p "$WASM_PKG_CACHE_DIR"
  # Entries are small and keyed by content; drop ones no build has used for a week.
  find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + || true
  local tmp
  tmp="$(mktemp -d "$WASM_PKG_CACHE_DIR/.tmp-XXXXXX")"
  cp -a "$1/." "$tmp/"
  mv -T "$tmp" "$entry" 2>/dev/null || rm -rf "$tmp"
}

if [ -d "$entry" ]; then
  echo "$package: unchanged inputs, reusing the cached wasm package ($key)"
  restore "$entry"
  touch "$entry"
  exit 0
fi

# The HTTP cache uses the remote sccache credentials the job configured; forks
# have none. PR jobs write it, as they write the cache volume.
remote=""
if [ -n "${SCCACHE_WEBDAV_ENDPOINT:-}" ] && [ -n "${SCCACHE_WEBDAV_TOKEN:-}" ]; then
  remote="$SCCACHE_WEBDAV_ENDPOINT/wasm-pkg/$package-$key.tar.zst"
fi

# The token goes through a config descriptor so it stays out of curl's arguments.
remote_request() {
  curl --fail --silent --show-error --max-time 60 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}

if [ -n "$remote" ]; then
  fetched="$(mktemp -d)"
  if remote_request "$remote" 2>/dev/null | zstd -d -q 2>/dev/null | tar -xf - -C "$fetched" 2>/dev/null \
    && [ -n "$(ls -A "$fetched")" ]; then
    echo "$package: unchanged inputs, restored the wasm package from the HTTP cache ($key)"
    restore "$fetched"
    store_locally "$fetched"
    rm -rf "$fetched"
    exit 0
  fi
  rm -rf "$fetched"
  echo "$package: not cached, building ($key)"
fi

"$@"

if [ -n "$remote" ]; then
  tar -C "$out_dir" -cf - . | zstd -q -3 -T0 | remote_request --upload-file - "$remote" \
    || echo "::warning::$package: could not store the wasm package in the HTTP cache"
fi
store_locally "$out_dir"
