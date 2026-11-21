#!/usr/bin/env bash
# The whole differential for #11219 in one command, against a running local
# stack (`just run_local --instance <instance>`):
#
#   tooling/difftest/soup-list/run.sh
#
# Serves main's app (OLD_CHECKOUT at OLD_REF) and the branch's (NEW_CHECKOUT at
# NEW_REF) from two Vite dev servers with the probe copied in, then runs the
# passes named in PASSES (default: all, in this order):
#   quiet     seed A, browser cache on: worlds, translator fuzz, callers and
#             one-shots, sequences;
#   load      seed B, the same under concurrent REST/GraphQL load;
#   cache-off seed C with the browser cache off (Vites restarted): smaller;
#   mutants   seed M: each planted mutant in its own lane, and a control lane;
#   aa        seed D, A/A control: main's app on both sides, from two
#             checkouts of OLD_REF (AA_CHECKOUT is the second) on two Vites,
#             sequences only: the base rate of every difference kind when
#             nothing changed.
# and writes results/<label>.json plus results/summary.json. Synthetic data
# only; every user and team it makes lives under *.difftest.dev.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
# bun and node come from the repository's dev shell.
command -v bun >/dev/null || exec nix develop "$repo" --command "$0" "$@"
INSTANCE=${INSTANCE:-gqlsoup}
STACK=${STACK:-https://localhost:23209}
NEW_CHECKOUT=${NEW_CHECKOUT:-$repo}
OLD_CHECKOUT=${OLD_CHECKOUT:-$repo-main}
AA_CHECKOUT=${AA_CHECKOUT:-$repo-main2}
NEW_REF=${NEW_REF:-21bd07dc3f6}
# The PR head merges main in; its second parent is the main it was tested on.
OLD_REF=${OLD_REF:-$(git -C "$NEW_CHECKOUT" rev-parse "$NEW_REF^2")}
NEW_PORT=${NEW_PORT:-23250}
OLD_PORT=${OLD_PORT:-23251}
SEEDS=(${SEEDS:-A1 B1 C1 M1 D1})
PASSES=${PASSES:-quiet load cache-off mutants aa}
FUZZ=${FUZZ:-1500}
SEQ_LANES=${SEQ_LANES:-13}
SEQS=${SEQS:-104}
STEPS=${STEPS:-20}
OUT=${OUT:-$here/results}
mkdir -p "$OUT"

# The apps must be exactly the commits the results name.
pairs=("$NEW_CHECKOUT:$NEW_REF" "$OLD_CHECKOUT:$OLD_REF")
[[ " $PASSES " == *" aa "* ]] && pairs+=("$AA_CHECKOUT:$OLD_REF")
for pair in "${pairs[@]}"; do
  dir=${pair%%:*} ref=${pair##*:}
  git -C "$dir" diff --quiet "$ref" -- apps packages ||
    { echo "$dir: apps/ or packages/ differ from $ref" >&2; exit 1; }
done
curl -skf -o /dev/null "$STACK/auth/health" || curl -sk -o /dev/null "$STACK" ||
  { echo "no stack at $STACK" >&2; exit 1; }

pids=()
stop_vites() {
  for p in "${pids[@]}"; do pkill -TERM -P "$p" 2>/dev/null || true; kill -TERM "$p" 2>/dev/null || true; done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done
  pids=()
}
trap stop_vites EXIT INT TERM

start_vites() { # <cache:on|off>
  ports=("$OLD_PORT" "$NEW_PORT")
  "$here/vite.sh" "$NEW_CHECKOUT" "$NEW_PORT" "$here/probe" "$1" "$STACK" >"$OUT/vite-new-$1.log" 2>&1 &
  pids+=($!)
  "$here/vite.sh" "$OLD_CHECKOUT" "$OLD_PORT" "$here/probe" "$1" "$STACK" >"$OUT/vite-old-$1.log" 2>&1 &
  pids+=($!)
  for port in "${ports[@]}"; do
    for _ in $(seq 1 120); do curl -sf -o /dev/null "http://localhost:$port/app" && break; sleep 1; done
  done
}

# The auth service lets one address create 50 users an hour; each run makes
# about 35 synthetic ones. Reset this local stack's counter before each run.
reset_user_limit() {
  docker exec "macro-$INSTANCE-redis-1" redis-cli --scan --pattern 'rtl_create_user_hourly:*' |
    xargs -r docker exec "macro-$INSTANCE-redis-1" redis-cli DEL >/dev/null
}

has() { [[ " $PASSES " == *" $1 "* ]]; }

run() { # <label> <seed> <cache> [args...]
  local label=$1 seed=$2 cache=$3
  shift 3
  reset_user_limit
  # The driver and its browser run in their own network namespace (netns.sh).
  (cd "$here" && "$here/netns.sh" "${STACK##*:},$NEW_PORT,$OLD_PORT" bun run run.ts --seed "$seed" --label "$label" --cache "$cache" \
    --out "$OUT/$label.json" --new "http://localhost:$NEW_PORT" --old "http://localhost:$OLD_PORT" \
    --stack "$STACK" --instance "$INSTANCE" --new-ref "$(git -C "$NEW_CHECKOUT" rev-parse "$NEW_REF")" \
    --old-ref "$(git -C "$OLD_CHECKOUT" rev-parse "$OLD_REF")" --lanes "${LANES:-8}" "$@") 2>&1 | tee "$OUT/$label.log"
}

if has quiet || has load || has mutants; then
  start_vites on
  has quiet && run quiet "${SEEDS[0]}" on --fuzz "$FUZZ" --seq-lanes "$SEQ_LANES" --seqs "$SEQS" --steps "$STEPS"
  has load && run load "${SEEDS[1]}" on --load --fuzz "$FUZZ" --seq-lanes "$SEQ_LANES" --seqs "$SEQS" --steps "$STEPS"
  has mutants && run mutants "${SEEDS[3]}" on --scale small --fuzz 0 --no-callers --seq-lanes 0 --mutants
  stop_vites
fi
if has cache-off; then
  start_vites off
  run cache-off "${SEEDS[2]}" off --scale small --fuzz $((FUZZ / 3)) --seq-lanes 4 --seqs 16 --steps "$STEPS"
  stop_vites
fi
if has aa; then
  # Main on both sides, each from its own checkout and Vite, as in the real
  # passes, so its timings compare with theirs.
  NEW_CHECKOUT=$AA_CHECKOUT NEW_REF=$OLD_REF start_vites on
  NEW_CHECKOUT=$AA_CHECKOUT NEW_REF=$OLD_REF run aa "${SEEDS[4]}" on --aa --scale small --fuzz 0 --no-callers \
    --seq-lanes "${AA_LANES:-8}" --seqs "${AA_SEQS:-48}" --steps "$STEPS"
  stop_vites
fi
labels=()
for l in quiet load cache-off mutants aa; do [ -f "$OUT/$l.json" ] && labels+=("$OUT/$l.json"); done
(cd "$here" && bun run summarize.ts "${labels[@]}" >"$OUT/summary.json")
echo "results in $OUT"
