#!/usr/bin/env bash
# Publish immutable objects before mutable entrypoints. Pulumi owns the ordering
# between these two phases and the routing Lambda update.
set -euo pipefail

phase="${1:?expected assets or entrypoints}"
dist="${2:?expected build directory}"
destination="${3:?expected s3://bucket/prefix}"
script_dir="$(\cd "$(dirname "$0")" && pwd)"

# These URLs name the current build, rather than a content-hashed object.
entrypoints=('*.html' '*.json' '*.txt' 'sw.js')
filters=(--exclude 'app-archive.zip')

case "$phase" in
  assets)
    bash "$script_dir/cache-wasm/upload-brotli-to-s3.sh" "$dist" "$destination" public-read
    filters+=(--exclude '*cache_wasm_bg*.wasm' --exclude '*cache_wasm_bg*.wasm.br')
    for pattern in "${entrypoints[@]}"; do filters+=(--exclude "$pattern"); done
    # Unlike sync, cp also repairs metadata on unchanged objects from older
    # builds, whose long lifetime previously came only from CloudFront.
    aws s3 cp "$dist" "$destination" --recursive --acl public-read \
      --cache-control 'public, max-age=31536000, immutable' "${filters[@]}"
    ;;
  entrypoints)
    filters+=(--exclude '*')
    for pattern in "${entrypoints[@]}"; do filters+=(--include "$pattern"); done
    aws s3 cp "$dist" "$destination" --recursive --acl public-read \
      --cache-control 'no-store' "${filters[@]}"
    ;;
  *)
    echo "unknown publishing phase: $phase" >&2
    exit 64
    ;;
esac
