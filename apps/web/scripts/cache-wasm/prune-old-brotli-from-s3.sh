#!/usr/bin/env bash
# Prune prior cache WASM objects only after every publication step succeeds.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: prune-old-brotli-from-s3.sh <dist-root> <s3-prefix> [retention-days]" >&2
  exit 2
fi

dist_root=$1
s3_prefix=${2%/}
retention_days=${3:-7}
if ! [[ "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo "retention days must be a positive integer" >&2
  exit 2
fi

raw_files=()
while IFS= read -r -d '' path; do
  raw_files+=("$path")
done < <(find "$dist_root" -type f -name 'cache_wasm_bg*.wasm' -print0)
if [ "${#raw_files[@]}" -ne 1 ]; then
  echo "expected one raw cache WASM; found ${#raw_files[@]}" >&2
  exit 1
fi
raw=${raw_files[0]}
relative_key=${raw#"${dist_root%/}"/}
if [ "$relative_key" = "$raw" ]; then
  echo "cache WASM is not contained by dist root" >&2
  exit 1
fi

s3_location=${s3_prefix#s3://}
if [ "$s3_location" = "$s3_prefix" ]; then
  echo "S3 prefix must start with s3://" >&2
  exit 2
fi
bucket=${s3_location%%/*}
if [ -z "$bucket" ]; then
  echo "S3 prefix must include a bucket" >&2
  exit 2
fi
if [[ "$s3_location" == */* ]]; then
  prefix=${s3_location#*/}
else
  prefix=''
fi
current_key=${prefix:+$prefix/}$relative_key
cutoff=$(date -u -d "$retention_days days ago" '+%Y-%m-%dT%H:%M:%SZ')
list_args=(s3api list-objects-v2 --bucket "$bucket")
if [ -n "$prefix" ]; then
  list_args+=(--prefix "$prefix/")
fi
list_args+=(
  --query "Contents[?LastModified<=\`$cutoff\`].Key"
  --output text
)

# Immutable hashed URLs can remain in recently served pages after a deploy.
# Preserve the current object and every generation inside the retention window;
# remove only matching cache WASM keys whose S3 LastModified is older.
while IFS= read -r key; do
  [ -n "$key" ] || continue
  [ "$key" != "None" ] || continue
  [ "$key" != "$current_key" ] || continue
  case "$key" in
    *cache_wasm_bg*.wasm) aws s3 rm "s3://$bucket/$key" ;;
  esac
done < <(aws "${list_args[@]}" | tr '\t' '\n')
