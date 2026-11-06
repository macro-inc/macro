#!/usr/bin/env bash
# [ci-speed] experiment: the brotli quality-11 sidecar of the cache wasm takes about
# 22 s single-threaded, and the wasm rarely changes. Reuse a sidecar made from the
# same bytes, from Namespace's HTTP cache, before compressing again.
set -euo pipefail
dist="$1"
if [ -z "${SCCACHE_WEBDAV_ENDPOINT:-}" ] || [ -z "${SCCACHE_WEBDAV_TOKEN:-}" ]; then
  exec bun scripts/cache-wasm/cli.ts package-dist --dist "$dist"
fi
wasm="$(find "$dist" -name 'cache_wasm_bg*.wasm' | head -n 1)"
if [ -z "$wasm" ]; then
  exec bun scripts/cache-wasm/cli.ts package-dist --dist "$dist"
fi
sha="$(sha256sum "$wasm" | cut -c1-64)"
remote="$SCCACHE_WEBDAV_ENDPOINT/wasm-br/$sha.br"
req() {
  curl --fail --silent --show-error --max-time 30 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}
if req -o "$wasm.br.tmp" "$remote" && [ -s "$wasm.br.tmp" ]; then
  mv "$wasm.br.tmp" "$wasm.br"
  echo "reused the brotli sidecar for $sha"
  exit 0
fi
rm -f "$wasm.br.tmp"
bun scripts/cache-wasm/cli.ts package-dist --dist "$dist"
req --upload-file "$wasm.br" "$remote" || echo "could not store the sidecar remotely" >&2
