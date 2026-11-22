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
# UPGRADE=1 starts both sides from the file SIDE_A left after the seed's case, so
# SIDE_B reads and writes on top of what the older build stored. UPGRADE_FROM=SIDE has that
# side write the file instead, so two newer builds both upgrade one older build's file.
# CHAIN_A and CHAIN_B (e.g. "a a" and "b a", a downgrade) run each side as a chain of builds on
# one file: the first build runs the case on an empty file, each next one reopens what the one
# before left and runs a probe and the case again.
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
if [ -n "${CHAIN_A:-}${CHAIN_B:-}" ]; then
  [[ "${CHAIN_A:-}" =~ ^[ab]( [ab])*$ ]] && [[ "${CHAIN_B:-}" =~ ^[ab]( [ab])*$ ]] \
    && [ "$(wc -w <<< "$CHAIN_A")" = "$(wc -w <<< "$CHAIN_B")" ] \
    || { echo "CHAIN_A and CHAIN_B must be equally long lists of a and b" >&2; exit 2; }
  [ -z "${UPGRADE:-}" ] || { echo "UPGRADE and CHAIN_A do not mix" >&2; exit 2; }
fi
if [ -n "${UPGRADE_FROM:-}" ]; then
  [ -n "${UPGRADE:-}" ] || { echo "UPGRADE_FROM needs UPGRADE=1" >&2; exit 2; }
  [[ "$UPGRADE_FROM" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "UPGRADE_FROM may hold only letters, digits, - and _" >&2; exit 2; }
fi
repo=$(git rev-parse --show-toplevel)
home=${CACHE_DIFF_FUZZ_HOME:-$HOME/.cache/cache-diff-fuzz}
out=$home/runs/$run
for name in "$side_a" "$side_b" ${UPGRADE_FROM:-}; do
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
# The upgrade file's writer runs as bin/u.
writer=a
if [ -n "${UPGRADE_FROM:-}" ]; then
  flock -s "$home/locks/side-$UPGRADE_FROM" sh -c 'cp "$1.side" "$2" && cp "$1" "$3"' _ \
    "$home/bin/$UPGRADE_FROM" "$out/u.side" "$work/bin/u"
  if [ "$(awk '$1 == "fuzzer" { print $3 }' "$out/u.side")" != "$hash_a" ]; then
    echo "$UPGRADE_FROM was not built from the same fuzzer sources as $side_a; rebuild one" >&2
    exit 1
  fi
  writer=u
fi
cp "$repo/static_assets/schema.graphql" "$work/schema.graphql"
cp -r "$repo/crates/client/cache-diff-fuzz/assets" "$work/assets"
{
  echo "sides $side_a $side_b"
  echo "seeds $first $count"
  echo "schema $(sha256sum < "$work/schema.graphql" | cut -c1-16)"
  echo "assets $(cd "$work/assets" && find . -type f | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-16)"
  echo "fuzz-args ${FUZZ_ARGS:-}"
  echo "fuzz-args-a ${FUZZ_ARGS_A:-}"
  echo "fuzz-args-b ${FUZZ_ARGS_B:-}"
  echo "upgrade ${UPGRADE:-} ${UPGRADE_FROM:-}"
  echo "chain-a ${CHAIN_A:-}"
  echo "chain-b ${CHAIN_B:-}"
} > "$out/run.txt"

writer_args=${FUZZ_ARGS_A:-}
[ "$writer" = u ] && writer_args=
export out work writer writer_args
# Returns non-zero only when it cannot record its result; a seed that fails or differs is
# recorded and returns 0.
one() {
  seed=$1
  # shellcheck disable=SC2206
  common=(--seed "$seed" --schema "$work/schema.graphql" --assets "$work/assets" ${FUZZ_ARGS:-})
  if [ -n "${UPGRADE:-}" ]; then
    # Side a (or UPGRADE_FROM) runs the case on an empty file and keeps what it leaves. Both
    # sides then start from that file (an upgrade, when b is the newer build): a probe of
    # everything, the case again, and its probes.
    up=$work/up/$seed
    mkdir -p "$up"
    # shellcheck disable=SC2086
    if ! { "$work/bin/$writer" "${common[@]}" $writer_args --emit-case --out "$up" --work "$up/w" \
      && jq -c '.ops = [{"op": "probe"}] + .ops' "$up/$seed.case.json" > "$up/upgrade.json" \
      && "$work/bin/$writer" "${common[@]}" $writer_args --keep --out "$up/o" --work "$up/w"; } \
      2> "$out/stderr/$seed.write"; then
      echo "$seed write-failed" >> "$out/failures.txt" || return 1
      rm -rf "${up:?}"
      return 0
    fi
    # A crash moves the engine to the next copy, db-1, db-2, …: the last is what it left.
    last=0
    while [ -d "$up/w/$seed/db-$((last + 1))" ]; do last=$((last + 1)); done
    common+=(--case "$up/upgrade.json" --start-from "$up/w/$seed/db-$last")
  fi
  status=ok
  if [ -n "${CHAIN_A:-}" ]; then
    # Each side runs a chain of builds on one file: the first runs the case on an empty
    # file, each next one starts from what the one before left, with a probe and the case
    # again. A side's trace is its segments' traces in order.
    up=$work/up/$seed
    mkdir -p "$up"
    # shellcheck disable=SC2086
    if ! { "$work/bin/a" "${common[@]}" --emit-case --out "$up" --work "$up/w" \
      && jq -c '.ops = [{"op": "probe"}] + .ops' "$up/$seed.case.json" > "$up/again.json"; } \
      2> "$out/stderr/$seed.write"; then
      echo "$seed write-failed" >> "$out/failures.txt" || return 1
      rm -rf "${up:?}"
      return 0
    fi
    for side in a b; do
      chain=$CHAIN_A
      [ "$side" = b ] && chain=$CHAIN_B
      : > "$up/$side.trace"
      segment=0
      for bin in $chain; do
        side_args=${FUZZ_ARGS_A:-}
        [ "$bin" = b ] && side_args=${FUZZ_ARGS_B:-}
        seg=$up/$side$segment
        start=(--case "$up/$seed.case.json")
        [ "$segment" -gt 0 ] && start=(--case "$up/again.json" --start-from "$from")
        # shellcheck disable=SC2086
        if ! "$work/bin/$bin" "${common[@]}" $side_args "${start[@]}" --keep --out "$seg" \
          --work "$seg/w" 2>> "$out/stderr/$seed.$side"; then
          status="$status $side-failed"
          break
        fi
        # Only the last segment's end would show in the side's trace: check each.
        if [ "$(tail -n 1 "$seg/$seed.trace" 2> /dev/null)" != end ]; then
          status="$status $side-segment-$segment-no-trace"
          break
        fi
        { echo "segment $segment"; cat "$seg/$seed.trace"; } >> "$up/$side.trace"
        # The side's counters are its segments' summed: a migration counts in a later segment.
        # A segment whose counters can't be read fails the seed rather than
        # leaving the earlier segments' counters standing for the whole chain.
        if [ "$segment" -eq 0 ]; then
          merged=$(cat "$seg/$seed.stats.json" 2> /dev/null) || merged=
        else
          merged=$(jq -s '.[0] + {counters: (reduce (.[].counters | to_entries[]) as $e ({}; .[$e.key] += $e.value))}' \
            "$out/$side/$seed.stats.json" "$seg/$seed.stats.json" 2> /dev/null) || merged=
        fi
        if [ -z "$merged" ]; then
          status="$status $side-segment-$segment-no-stats"
          break
        fi
        printf '%s\n' "$merged" > "$out/$side/$seed.stats.json"
        # A crash moves the engine to the next copy: the last is what the segment left.
        last=0
        while [ -d "$seg/w/$seed/db-$((last + 1))" ]; do last=$((last + 1)); done
        from=$seg/w/$seed/db-$last
        segment=$((segment + 1))
      done
      cp "$up/$side.trace" "$out/$side/$seed.trace"
    done
    status=${status/#ok /}
  else
  # shellcheck disable=SC2086
  "$work/bin/a" "${common[@]}" ${FUZZ_ARGS_A:-} --out "$out/a" --work "$work/a" \
    2> "$out/stderr/$seed.a" || status="a-failed"
  # shellcheck disable=SC2086
  "$work/bin/b" "${common[@]}" ${FUZZ_ARGS_B:-} --out "$out/b" --work "$work/b" \
    2> "$out/stderr/$seed.b" || status="$status b-failed"
  fi
  for side in a b; do
    # A finished trace ends with `end`.
    [ -f "$out/$side/$seed.trace" ] && [ "$(tail -n 1 "$out/$side/$seed.trace")" = end ] \
      || status="$status $side-no-trace"
  done
  # With --abandon-reads, where a reported an operation an abandoned read had
  # registered broadly, b must report it too (b is the side that abandons).
  if [ "$status" = ok ] && [ -f "$out/a/$seed.broad" ]; then
    if [ ! -f "$out/b/$seed.broad" ]; then
      status="b-no-broad"
    elif [ -n "$(comm -23 <(sort "$out/a/$seed.broad") <(sort "$out/b/$seed.broad"))" ]; then
      status="broad-dropped:$(comm -23 <(sort "$out/a/$seed.broad") <(sort "$out/b/$seed.broad") | head -1 | tr ' ' @)"
    else
      rm -f "$out/a/$seed.broad" "$out/b/$seed.broad"
    fi
  fi
  same=0
  [ "$status" = ok ] && { cmp -s "$out/a/$seed.trace" "$out/b/$seed.trace" || same=$?; }
  if [ -n "${UPGRADE:-}${CHAIN_A:-}" ]; then
    # The starting file and the upgrade case are kept for any seed that needs a look.
    if [ "$status" = ok ] && [ "$same" -eq 0 ]; then
      rm -rf "${up:?}"
    else
      mkdir -p "$out/upgrade" && mv "$up" "$out/upgrade/$seed"
    fi
  fi
  if [ "$status" != ok ]; then
    echo "$seed $status" >> "$out/failures.txt" || return 1
    return 0
  fi
  rm -f "$out/stderr/$seed.a" "$out/stderr/$seed.b" "$out/stderr/$seed.write"
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
seq "$first" $((first + count - 1)) | xargs -P "$jobs" -I{} bash -c 'set -euo pipefail; one "$1"' _ {} || recorded=$?
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
