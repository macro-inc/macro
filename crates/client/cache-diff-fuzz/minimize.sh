#!/usr/bin/env bash
# Shrinks a seed whose traces differ between two sides to a short case that still differs.
#
#   minimize.sh SEED SIDE_A SIDE_B [JOBS]
#
# Delta debugging over the generated operations: drop a chunk, rerun both sides on what is
# left, keep the drop when both sides still finish and their traces still differ. The result
# is $CACHE_DIFF_FUZZ_HOME/min/SEED/case.json; rerun it with `--case`, and `--full` to see
# every response.
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: minimize.sh SEED SIDE_A SIDE_B [JOBS]" >&2
  exit 2
fi
seed=$1
side_a=$2
side_b=$3
jobs=${4:-8}
case "$seed" in
  '' | *[!0-9]*) echo "SEED must be a number" >&2; exit 2 ;;
esac
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
for side in "$side_a" "$side_b"; do
  [ -x "$home/bin/$side" ] || { echo "no built side $side" >&2; exit 2; }
done
out=$home/min/$seed
rm -rf "${out:?}"
mkdir -p "$out/try"
common=(--schema "$repo/static_assets/schema.graphql" --assets "$repo/crates/client/cache-diff-fuzz/assets")

"$home/bin/$side_a" --seed "$seed" "${common[@]}" ${FUZZ_ARGS:-} --emit-case --out "$out" --work "$out/work"
mv "$out/$seed.case.json" "$out/case.json"

export home side_a side_b out
export common_args="${common[*]}"
# Exit 0 when both sides finish the case in $1 and their traces differ. A case that makes a
# side fail is a different finding, not a smaller copy of this one.
differs() {
  local case=$1 dir
  dir=$(dirname "$case")
  mkdir -p "$dir/a" "$dir/b"
  # shellcheck disable=SC2086
  "$home/bin/$side_a" --seed 0 $common_args --case "$case" --out "$dir/a" --work "$dir/wa" 2> /dev/null || return 1
  # shellcheck disable=SC2086
  "$home/bin/$side_b" --seed 0 $common_args --case "$case" --out "$dir/b" --work "$dir/wb" 2> /dev/null || return 1
  [ -s "$dir/a/0.trace" ] && [ -s "$dir/b/0.trace" ] || return 1
  ! cmp -s "$dir/a/0.trace" "$dir/b/0.trace"
}
export -f differs

if ! differs "$out/case.json"; then
  echo "seed $seed: both sides do not finish with different traces, nothing to minimize"
  exit 1
fi

granularity=2
while true; do
  length=$(jq '.ops | length' "$out/case.json")
  [ "$length" -lt 2 ] && break
  [ "$granularity" -gt "$length" ] && granularity=$length
  chunk=$(((length + granularity - 1) / granularity))
  rm -rf "${out:?}/try"
  for ((index = 0; index < granularity; index++)); do
    start=$((index * chunk))
    [ "$start" -ge "$length" ] && break
    mkdir -p "$out/try/$index"
    jq -c --argjson a "$start" --argjson b $((start + chunk)) '.ops |= (.[:$a] + .[$b:])' \
      "$out/case.json" > "$out/try/$index/case.json"
  done
  # `|| true` per attempt: a case that no longer differs is the normal outcome, not an error.
  found=$(find "$out/try" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort -n \
    | xargs -P "$jobs" -I{} bash -c 'if differs "$0/try/{}/case.json"; then echo {}; fi' "$out" \
    | sort -n | head -1)
  if [ -n "$found" ]; then
    cp "$out/try/$found/case.json" "$out/case.json"
    granularity=$((granularity > 2 ? granularity - 1 : 2))
    echo "seed $seed: $(jq '.ops | length' "$out/case.json") ops"
  elif [ "$granularity" -ge "$length" ]; then
    break
  else
    granularity=$((granularity * 2))
  fi
done
rm -rf "${out:?}/try" "${out:?}/work"
# shellcheck disable=SC2086
"$home/bin/$side_a" --seed 0 $common_args --case "$out/case.json" --full --out "$out/a" --work "$out/wa"
# shellcheck disable=SC2086
"$home/bin/$side_b" --seed 0 $common_args --case "$out/case.json" --full --out "$out/b" --work "$out/wb"
rm -rf "${out:?}/wa" "${out:?}/wb"
echo "seed $seed: minimal case $out/case.json ($(jq '.ops | length' "$out/case.json") ops)"
jq -c '.ops[] | {op}' "$out/case.json" | tr '\n' ' '
echo
diff "$out/a/0.full" "$out/b/0.full" | cut -c1-400 | head -12 || true
