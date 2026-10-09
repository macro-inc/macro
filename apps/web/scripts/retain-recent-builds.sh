#!/usr/bin/env bash
# Remove published assets that no recent build refers to.
#
# This replaces `aws s3 sync --delete`. That flag deleted the previous build's
# content-hashed files the moment a new build landed, which breaks tabs that
# are still open: the app fetches most of itself lazily - views, modals, block
# components, the fold worker and its WASM - so a tab that has not needed a
# chunk yet asks for it long after the build that owns it stopped being
# current. The client moves tabs to a new build deliberately gently (it will
# not interrupt someone typing), so that window is minutes to hours, not
# seconds. Deleting on deploy turned every such fetch into a 404; for the fold
# worker that surfaced as an unexplained worker failure, because a module
# worker whose script 404s reports an error with no message.
#
# So each deploy records the keys it publishes, and this prunes anything the
# last <keep-builds> records do not, between them, still refer to. Whatever
# the records say, nothing the build being published right now is ever
# removed.
#
# <keep-builds> counts the build being published, so 10 keeps this one and the
# nine before it.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: retain-recent-builds.sh <dist-root> <s3-prefix> [keep-builds]" >&2
  exit 2
fi

dist_root=${1%/}
s3_prefix=${2%/}
keep_builds=${3:-10}
if ! [[ "$keep_builds" =~ ^[1-9][0-9]*$ ]]; then
  echo "keep-builds must be a positive integer" >&2
  exit 2
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
key_prefix=${prefix:+$prefix/}
records_prefix=${key_prefix}_builds

# The build number the shell advertises as `macro-bundle-build`, so a record
# sorts by the same clock the service worker compares builds with.
manifest=$dist_root/bundle-manifest.json
if [ ! -f "$manifest" ]; then
  echo "no bundle manifest at $manifest" >&2
  exit 1
fi
build=$(sed -n 's/.*"bundleBuild"[[:space:]]*:[[:space:]]*\([0-9]\{1,\}\).*/\1/p' "$manifest" | head -1)
if [ -z "$build" ]; then
  echo "bundle manifest has no bundleBuild" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
published=$work/published
retained=$work/retained
existing=$work/existing

# What this build publishes, as the keys the sync wrote them to.
(cd "$dist_root" && find . -type f) |
  sed "s|^\./|$key_prefix|" |
  LC_ALL=C sort -u >"$published"
# Every build publishes a shell. Its absence means the output handed to this
# script is not a build, and pruning against it would retire live assets.
if ! LC_ALL=C grep -qx "${key_prefix}index.html" "$published"; then
  echo "no ${key_prefix}index.html under $dist_root; refusing to prune" >&2
  exit 1
fi

aws s3 cp "$published" "s3://$bucket/$records_prefix/$build.txt" >/dev/null

# Newest builds first, so the tail of the list is what falls out of retention.
mapfile -t records < <(
  aws s3api list-objects-v2 --bucket "$bucket" --prefix "$records_prefix/" \
    --query 'Contents[].Key' --output text |
    tr '\t' '\n' |
    sed -n 's|.*/\([0-9]\{1,\}\)\.txt$|\1|p' |
    LC_ALL=C sort -rn
)

# This build's own keys first: a record that cannot be read back must never be
# able to make the live build look prunable.
cp "$published" "$retained"
kept=0
for record in "${records[@]}"; do
  kept=$((kept + 1))
  if [ "$kept" -le "$keep_builds" ]; then
    aws s3 cp "s3://$bucket/$records_prefix/$record.txt" - >>"$retained"
  else
    aws s3 rm "s3://$bucket/$records_prefix/$record.txt" >/dev/null
  fi
done
LC_ALL=C sort -u "$retained" -o "$retained"

list_args=(s3api list-objects-v2 --bucket "$bucket")
if [ -n "$prefix" ]; then
  list_args+=(--prefix "$key_prefix")
fi
list_args+=(--query 'Contents[].Key' --output text)
aws "${list_args[@]}" |
  tr '\t' '\n' |
  sed '/^$/d; /^None$/d' |
  LC_ALL=C sort -u >"$existing"

# Keys nothing retained refers to. `index.html` is republished every deploy so
# it is always retained; the exclusions below are for objects this script does
# not own - the records themselves, the archive uploaded as its own resource,
# and the cache WASM, which `prune-old-brotli-from-s3.sh` retires on its own
# schedule because the generic sync never uploads it.
while IFS= read -r key; do
  [ -n "$key" ] || continue
  case "$key" in
  "$records_prefix"/*) continue ;;
  *app-archive.zip | app-archive/*) continue ;;
  *cache_wasm_bg*) continue ;;
  *index.html) continue ;;
  esac
  aws s3 rm "s3://$bucket/$key" >/dev/null
done < <(LC_ALL=C comm -23 "$existing" "$retained")
