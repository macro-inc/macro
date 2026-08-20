#!/usr/bin/env bash
# Upload the precompressed cache WASM bytes at the original .wasm key. The
# caller's generic sync must exclude both cache_wasm_bg*.wasm and *.wasm.br.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: upload-brotli-to-s3.sh <dist-root> <s3-prefix> [acl]" >&2
  exit 2
fi

dist_root=$1
s3_prefix=${2%/}
acl=${3:-}
raw_files=()
while IFS= read -r -d '' path; do
  raw_files+=("$path")
done < <(find "$dist_root" -type f -name 'cache_wasm_bg*.wasm' -print0)
sidecars=()
while IFS= read -r -d '' path; do
  sidecars+=("$path")
done < <(find "$dist_root" -type f -name 'cache_wasm_bg*.wasm.br' -print0)
if [ "${#raw_files[@]}" -ne 1 ] || [ "${#sidecars[@]}" -ne 1 ]; then
  echo "expected one raw cache WASM and one Brotli sidecar; found ${#raw_files[@]} raw / ${#sidecars[@]} sidecar" >&2
  exit 1
fi
raw=${raw_files[0]}
sidecar=${sidecars[0]}
if [ "$sidecar" != "$raw.br" ]; then
  echo "cache WASM sidecar is not adjacent to its raw artifact" >&2
  exit 1
fi
if ! brotli --decompress --stdout "$sidecar" | cmp --silent - "$raw"; then
  echo "cache WASM sidecar does not decompress to the raw artifact" >&2
  exit 1
fi
relative_key=${raw#"${dist_root%/}"/}
if [ "$relative_key" = "$raw" ]; then
  echo "cache WASM is not contained by dist root" >&2
  exit 1
fi
args=(
  s3 cp "$sidecar" "$s3_prefix/$relative_key"
  --content-type application/wasm
  --content-encoding br
  --cache-control 'public, max-age=31536000, immutable'
)
if [ -n "$acl" ]; then
  args+=(--acl "$acl")
fi
# Pruning is intentionally a separate post-publication operation. A failure in
# this upload or any later generic/index publish step must retain prior keys.
aws "${args[@]}"
