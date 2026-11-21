#!/usr/bin/env bash
# Runs seeds FIRST..FIRST+COUNT-1 on two built sides and compares their traces.
#
#   fuzz.sh RUN FIRST COUNT SIDE_A SIDE_B [JOBS]
#
# Sides are binaries built by build-side.sh. SIDE_A and SIDE_B may be the same
# side, to check that a build agrees with itself. Results go to
# $CACHE_DIFF_FUZZ_HOME/runs/RUN, which must not exist yet: a/ and b/ hold each
# seed's trace and counters, diffs.txt names each seed whose traces differ and
# the first line that does, failures.txt each seed a side could not finish.
# Exits 0 only when every seed finished on both sides with the same trace.
set -euo pipefail

if [ $# -lt 5 ]; then
  echo "usage: fuzz.sh RUN FIRST COUNT SIDE_A SIDE_B [JOBS]" >&2
  exit 2
fi
run=$1
first=$2
count=$3
side_a=$4
side_b=$5
jobs=${6:-12}
case "$run$first$count$jobs" in
  */* | *..*) echo "RUN must be a plain name" >&2; exit 2 ;;
esac
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
out=$home/runs/$run
fuzzer() {
  local stamp=$home/bin/$1.side hash
  [ -x "$home/bin/$1" ] && [ -f "$stamp" ] || { echo "no built side $1" >&2; return 1; }
  hash=$(awk '$1 == "fuzzer" { print $3 }' "$stamp")
  [ -n "$hash" ] || { echo "$stamp has no fuzzer hash" >&2; return 1; }
  echo "$hash"
}
hash_a=$(fuzzer "$side_a")
hash_b=$(fuzzer "$side_b")
if [ "$hash_a" != "$hash_b" ]; then
  echo "$side_a and $side_b were built with different fuzzer sources; rebuild one" >&2
  exit 1
fi
if [ -e "$out" ]; then
  echo "$out exists; pick a new RUN name" >&2
  exit 1
fi
mkdir -p "$out/a" "$out/b" "$out/stderr"
cp "$home/bin/$side_a.side" "$out/a.side"
cp "$home/bin/$side_b.side" "$out/b.side"
{
  echo "sides $side_a $side_b"
  echo "seeds $first $count"
  echo "schema $(sha256sum < "$repo/static_assets/schema.graphql" | cut -c1-16)"
  echo "fuzz-args ${FUZZ_ARGS:-}"
} > "$out/run.txt"

# Each run has its own scratch space, so runs can go at the same time.
work=$home/work/$run
export repo home out side_a side_b work
one() {
  seed=$1
  common=(--seed "$seed" --schema "$repo/static_assets/schema.graphql"
    --assets "$repo/crates/client/cache-diff-fuzz/assets" ${FUZZ_ARGS:-})
  status=ok
  "$home/bin/$side_a" "${common[@]}" --out "$out/a" --work "$work/a" \
    2> "$out/stderr/$seed.a" || status="a-failed"
  "$home/bin/$side_b" "${common[@]}" --out "$out/b" --work "$work/b" \
    2> "$out/stderr/$seed.b" || status="$status b-failed"
  for side in a b; do
    [ -s "$out/$side/$seed.trace" ] || status="$status $side-no-trace"
  done
  if [ "$status" != ok ]; then
    echo "$seed $status" >> "$out/failures.txt"
    return 0
  fi
  rm -f "$out/stderr/$seed.a" "$out/stderr/$seed.b"
  if ! cmp -s "$out/a/$seed.trace" "$out/b/$seed.trace"; then
    first_diff=$(diff "$out/a/$seed.trace" "$out/b/$seed.trace" | head -3 | tr '\n' ' ' || true)
    echo "$seed $first_diff" >> "$out/diffs.txt"
  else
    # Matching traces need no keeping; the counters stay for coverage.
    rm -f "$out/a/$seed.trace" "$out/b/$seed.trace"
  fi
}
export -f one
seq "$first" $((first + count - 1)) | xargs -P "$jobs" -I{} bash -c 'one {}'
rm -rf "${work:?}"
total=$(find "$out/a" -name '*.stats.json' | wc -l)
lines() { if [ -f "$1" ]; then wc -l < "$1"; else echo 0; fi; }
diffs=$(lines "$out/diffs.txt")
failures=$(lines "$out/failures.txt")
echo "run $run: $total seeds finished, $diffs differ, $failures failed"
[ "$diffs" -eq 0 ] && [ "$failures" -eq 0 ] && [ "$total" -eq "$count" ]
