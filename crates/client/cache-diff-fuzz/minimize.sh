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
[[ "$seed" =~ ^(0|[1-9][0-9]{0,18})$ ]] || { echo "SEED must be a decimal number" >&2; exit 2; }
[[ "$jobs" =~ ^[1-9][0-9]{0,3}$ ]] || { echo "JOBS must be a number from 1" >&2; exit 2; }
for plain in "$side_a" "$side_b"; do
  [[ "$plain" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "side names may hold only letters, digits, - and _" >&2; exit 2; }
done
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
for side in "$side_a" "$side_b"; do
  [ -x "$home/bin/$side" ] && [ -f "$home/bin/$side.side" ] || { echo "no built side $side" >&2; exit 2; }
done
mkdir -p "$home/min"
# One minimizer per seed at a time; the lock lasts as long as this shell.
exec 9> "$home/min/$seed.lock"
flock -n 9 || { echo "another minimize.sh is working on seed $seed" >&2; exit 1; }
out=$home/min/$seed
rm -rf "${out:?}"
mkdir -p "$out/try" "$out/bin"
# Copies, so a rebuild or an edit meanwhile cannot change what either side runs on. Each
# binary is copied with its stamp under the side's lock, so the two come from one build.
# One side against itself runs one snapshot twice.
mkdir -p "$home/locks"
flock -s "$home/locks/side-$side_a" sh -c 'cp "$1.side" "$2.side" && cp "$1" "$2"' _ "$home/bin/$side_a" "$out/bin/a"
if [ "$side_b" = "$side_a" ]; then
  cp "$out/bin/a.side" "$out/bin/b.side"
  cp "$out/bin/a" "$out/bin/b"
else
  flock -s "$home/locks/side-$side_b" sh -c 'cp "$1.side" "$2.side" && cp "$1" "$2"' _ "$home/bin/$side_b" "$out/bin/b"
fi
hash_a=$(awk '$1 == "fuzzer" { print $3 }' "$out/bin/a.side")
hash_b=$(awk '$1 == "fuzzer" { print $3 }' "$out/bin/b.side")
if [ -z "$hash_a" ] || [ "$hash_a" != "$hash_b" ]; then
  echo "$side_a and $side_b were not built from the same fuzzer sources; rebuild one" >&2
  exit 1
fi
cp "$repo/static_assets/schema.graphql" "$out/schema.graphql"
cp -r "$repo/crates/client/cache-diff-fuzz/assets" "$out/assets"

# shellcheck disable=SC2086
"$out/bin/a" --seed "$seed" --schema "$out/schema.graphql" --assets "$out/assets" ${FUZZ_ARGS:-} \
  --emit-case --out "$out" --work "$out/work"
mv "$out/$seed.case.json" "$out/case.json"

export out
# run SIDE CASE DIR: runs one side on a case; the trace lands in DIR/SIDE/0.trace.
run() {
  local side_args=${FUZZ_ARGS_B:-}
  [ "$1" = a ] && side_args=${FUZZ_ARGS_A:-}
  # shellcheck disable=SC2086
  "$out/bin/$1" --seed 0 --schema "$out/schema.graphql" --assets "$out/assets" \
    ${FUZZ_ARGS:-} $side_args --case "$2" --out "$3/$1" --work "$3/w$1" "${@:4}"
}
# Exit 0 when both sides finish the case in $1 and their traces differ. A case that makes a
# side fail is a different finding, not a smaller copy of this one.
differs() {
  local case=$1 dir same=0
  dir=$(dirname "$case")
  run a "$case" "$dir" 2> /dev/null || return 1
  run b "$case" "$dir" 2> /dev/null || return 1
  [ "$(tail -n 1 "$dir/a/0.trace")" = end ] && [ "$(tail -n 1 "$dir/b/0.trace")" = end ] || return 1
  cmp -s "$dir/a/0.trace" "$dir/b/0.trace" || same=$?
  [ "$same" -eq 1 ]
}
export -f run differs

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
  # A case that no longer differs is the normal outcome, not an error. awk reads the whole
  # stream, so no stage sees a closed pipe.
  found=$(find "$out/try" -mindepth 1 -maxdepth 1 -printf '%f\n' \
    | xargs -P "$jobs" -I{} bash -c 'if differs "$out/try/{}/case.json"; then echo {}; fi' \
    | sort -n | awk 'NR == 1')
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
run a "$out/case.json" "$out" --full
run b "$out/case.json" "$out" --full
rm -rf "${out:?}/wa" "${out:?}/wb"
# The same test as for every candidate: both traces finished, and they differ.
witness=2
if [ "$(tail -n 1 "$out/a/0.trace")" = end ] && [ "$(tail -n 1 "$out/b/0.trace")" = end ]; then
  witness=0
  cmp -s "$out/a/0.trace" "$out/b/0.trace" || witness=$?
fi
if [ "$witness" -ne 1 ]; then
  echo "seed $seed: the minimal case does not differ on a rerun (nondeterministic?)" >&2
  exit 1
fi
echo "seed $seed: minimal case $out/case.json ($(jq '.ops | length' "$out/case.json") ops)"
jq -c '.ops[] | {op}' "$out/case.json" | tr '\n' ' '
echo
diff "$out/a/0.full" "$out/b/0.full" | cut -c1-400 | head -12 || true
