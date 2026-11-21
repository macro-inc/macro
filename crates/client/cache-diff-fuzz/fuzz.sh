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
for plain in "$run" "$side_a" "$side_b"; do
  [[ "$plain" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "RUN and side names may hold only letters, digits, - and _" >&2; exit 2; }
done
# Plain decimals, small enough that Bash's signed arithmetic and seq agree with the binary.
for number in "$first" "$count" "$jobs"; do
  [[ "$number" =~ ^(0|[1-9][0-9]{0,15})$ ]] || { echo "FIRST, COUNT and JOBS must be decimal numbers below 10^16" >&2; exit 2; }
done
if [ "$count" -lt 1 ] || [ "$jobs" -lt 1 ]; then
  echo "COUNT and JOBS must be at least 1" >&2
  exit 2
fi
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
out=$home/runs/$run
for name in "$side_a" "$side_b"; do
  [ -x "$home/bin/$name" ] && [ -f "$home/bin/$name.side" ] || { echo "no built side $name" >&2; exit 1; }
done
mkdir -p "$home/runs"
# mkdir is the reservation: two runs with one name cannot both get it.
mkdir "$out" 2> /dev/null || { echo "$out exists; pick a new RUN name" >&2; exit 1; }
work=$home/work/$run
rm -rf "${work:?}"
trap 'rm -rf "${work:?}"' EXIT
mkdir -p "$out/a" "$out/b" "$out/stderr" "$work/bin"

# The run uses copies of both binaries, the schema and the assets, so a rebuild or an edit
# while it goes cannot change one side's inputs.
mkdir -p "$home/locks"
for side in a b; do
  name=$side_a
  [ "$side" = b ] && name=$side_b
  if [ "$side" = b ] && [ "$side_b" = "$side_a" ]; then
    # One side against itself runs one snapshot twice, not two builds.
    cp "$out/a.side" "$out/b.side"
    cp "$work/bin/a" "$work/bin/b"
    continue
  fi
  # Under the side's lock, so the binary and its stamp come from the same build.
  flock -s "$home/locks/side-$name" sh -c 'cp "$1.side" "$2" && cp "$1" "$3"' _ \
    "$home/bin/$name" "$out/$side.side" "$work/bin/$side"
done
hash_a=$(awk '$1 == "fuzzer" { print $3 }' "$out/a.side")
hash_b=$(awk '$1 == "fuzzer" { print $3 }' "$out/b.side")
if [ -z "$hash_a" ] || [ "$hash_a" != "$hash_b" ]; then
  echo "$side_a and $side_b were not built from the same fuzzer sources; rebuild one" >&2
  exit 1
fi
cp "$repo/static_assets/schema.graphql" "$work/schema.graphql"
cp -r "$repo/crates/client/cache-diff-fuzz/assets" "$work/assets"
{
  echo "sides $side_a $side_b"
  echo "seeds $first $count"
  echo "schema $(sha256sum < "$work/schema.graphql" | cut -c1-16)"
  echo "assets $(cd "$work/assets" && find . -type f | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-16)"
  echo "fuzz-args ${FUZZ_ARGS:-}"
} > "$out/run.txt"

export out work
# Returns non-zero only when it cannot record its result; a seed that fails or differs is
# recorded and returns 0.
one() {
  seed=$1
  # shellcheck disable=SC2206
  common=(--seed "$seed" --schema "$work/schema.graphql" --assets "$work/assets" ${FUZZ_ARGS:-})
  status=ok
  "$work/bin/a" "${common[@]}" --out "$out/a" --work "$work/a" \
    2> "$out/stderr/$seed.a" || status="a-failed"
  "$work/bin/b" "${common[@]}" --out "$out/b" --work "$work/b" \
    2> "$out/stderr/$seed.b" || status="$status b-failed"
  for side in a b; do
    # A finished trace ends with `end`.
    [ -f "$out/$side/$seed.trace" ] && [ "$(tail -n 1 "$out/$side/$seed.trace")" = end ] \
      || status="$status $side-no-trace"
  done
  if [ "$status" != ok ]; then
    echo "$seed $status" >> "$out/failures.txt" || return 1
    return 0
  fi
  rm -f "$out/stderr/$seed.a" "$out/stderr/$seed.b"
  same=0
  cmp -s "$out/a/$seed.trace" "$out/b/$seed.trace" || same=$?
  case $same in
    0) rm -f "$out/a/$seed.trace" "$out/b/$seed.trace" ;; # matching traces need no keeping
    1)
      first_diff=$(diff "$out/a/$seed.trace" "$out/b/$seed.trace" | head -3 | tr '\n' ' ' || true)
      echo "$seed $first_diff" >> "$out/diffs.txt" || return 1
      ;;
    *) echo "$seed compare-failed" >> "$out/failures.txt" || return 1 ;;
  esac
}
export -f one
recorded=0
seq "$first" $((first + count - 1)) | xargs -P "$jobs" -I{} bash -c 'one {}' || recorded=$?
total=$(find "$out/a" -name '*.stats.json' | wc -l)
lines() { if [ -f "$1" ]; then wc -l < "$1"; else echo 0; fi; }
diffs=$(lines "$out/diffs.txt")
failures=$(lines "$out/failures.txt")
echo "run $run: $total seeds finished, $diffs differ, $failures failed"
if [ "$recorded" -ne 0 ]; then
  echo "some seeds could not record their result (xargs exit $recorded)" >&2
  exit 1
fi
[ "$diffs" -eq 0 ] && [ "$failures" -eq 0 ] && [ "$total" -eq "$count" ]
