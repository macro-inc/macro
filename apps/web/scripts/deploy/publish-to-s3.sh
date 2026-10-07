#!/usr/bin/env bash
# Publish every dependency before either mutable web entry point.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: publish-to-s3.sh <dist-root> <s3-prefix>" >&2
  exit 2
fi

dist_root=${1%/}
s3_prefix=${2%/}
script_dir=$(dirname "${BASH_SOURCE[0]}")
test -f "$dist_root/index.html"
test -f "$dist_root/sw.js"

bash "$script_dir/../cache-wasm/upload-brotli-to-s3.sh" "$dist_root" "$s3_prefix" public-read
# Keep old chunks for existing tabs. The post-publication pruner gives retired
# assets a grace period; --delete here would break those tabs immediately.
aws s3 sync "$dist_root" "$s3_prefix" --acl public-read \
  --exclude "index.html" --exclude "sw.js" --exclude "app-archive.zip" \
  --exclude "*cache_wasm_bg*.wasm" --exclude "*cache_wasm_bg*.wasm.br"
aws s3 cp "$dist_root/index.html" "$s3_prefix/index.html" \
  --content-type text/html --cache-control no-store --acl public-read
aws s3 cp "$dist_root/sw.js" "$s3_prefix/sw.js" \
  --content-type text/javascript --cache-control no-store --acl public-read
