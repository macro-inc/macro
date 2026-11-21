#!/usr/bin/env bash
# Runs seeds FIRST..FIRST+COUNT-1 on two built sides and compares their traces.
#
#   fuzz.sh RUN FIRST COUNT SIDE_A SIDE_B [JOBS]
#
# Sides are binaries built by build-side.sh. SIDE_A and SIDE_B may be the same
# side, to check that a build agrees with itself. Results go to
# $CACHE_DIFF_FUZZ_HOME/runs/RUN: a/ and b/ hold each seed's trace and counters,
# diffs.txt names each seed whose traces differ and the first line that does,
# failures.txt each seed a side could not finish.
set -euo pipefail

run=$1
first=$2
count=$3
side_a=$4
side_b=$5
jobs=${6:-12}
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
out=$home/runs/$run
mkdir -p "$out/a" "$out/b" "$out/stderr"
cp "$home/bin/$side_a.side" "$out/a.side"
cp "$home/bin/$side_b.side" "$out/b.side"
echo "$side_a $side_b $first $count" >> "$out/runs.txt"

export repo home out side_a side_b
one() {
  seed=$1
  common=(--seed "$seed" --schema "$repo/static_assets/schema.graphql"
    --assets "$repo/crates/client/cache-diff-fuzz/assets" ${FUZZ_ARGS:-})
  status=ok
  "$home/bin/$side_a" "${common[@]}" --out "$out/a" --work "$home/work/$run-a" \
    2> "$out/stderr/$seed.a" || status="a-failed"
  "$home/bin/$side_b" "${common[@]}" --out "$out/b" --work "$home/work/$run-b" \
    2> "$out/stderr/$seed.b" || status="$status b-failed"
  if [ "$status" != ok ]; then
    echo "$seed $status" >> "$out/failures.txt"
    return 0
  fi
  rm -f "$out/stderr/$seed.a" "$out/stderr/$seed.b"
  if ! cmp -s "$out/a/$seed.trace" "$out/b/$seed.trace"; then
    first_diff=$(diff "$out/a/$seed.trace" "$out/b/$seed.trace" | head -3 | tr '\n' ' ')
    echo "$seed $first_diff" >> "$out/diffs.txt"
  else
    # Matching traces need no keeping; the counters stay for coverage.
    rm -f "$out/a/$seed.trace" "$out/b/$seed.trace"
  fi
}
export -f one
seq "$first" $((first + count - 1)) | xargs -P "$jobs" -I{} bash -c 'one {}'
total=$(ls "$out/a" | grep -c '\.stats\.json$' || true)
diffs=$(wc -l < "$out/diffs.txt" 2> /dev/null || echo 0)
failures=$(wc -l < "$out/failures.txt" 2> /dev/null || echo 0)
echo "run $run: $total seeds finished, $diffs differ, $failures failed"
