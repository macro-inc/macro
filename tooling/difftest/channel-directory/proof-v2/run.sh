#!/usr/bin/env bash
# One command for the channel directory differential: main (M) against the
# branch with the GraphQL device cache (C) and without it (N), on one local
# stack, same data, same time. Synthetic data only (seed-v2.ts).
#
#   proof-v2/run.sh [all|bundles|read|quiet|loaded|mutants|summary]
#
# Needs: the gqlchan stack up (just run_local --instance gqlchan), seeded with
# `bun seed-v2.ts` and signed in (sessions-v2.json, never committed); a main
# checkout at the branch's merge base in $MAIN_TREE and the branch checkout in
# $BRANCH_TREE. Results land in proof-v2/runs/final/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
MAIN_TREE="${MAIN_TREE:-$HOME/.cache/gql-channel-directory/old-main}"
BRANCH_TREE="${BRANCH_TREE:-$HOME/.cache/gql-channel-directory/new-head}"
OUT="${OUT:-$here/runs/final}"
SEEDS="${SEEDS:-20261121 20261120}"
SEQUENCES="${SEQUENCES:-10}"
STEPS="${STEPS:-20}"
LIVE_MS="${LIVE_MS:-10000}"
QUIET_GROUPS="${QUIET_GROUPS:-q01,q02,q03,q04,q05,q06,q07,q08,q09,q10}"
LOADED_GROUPS="${LOADED_GROUPS:-l01,l02,l03,l04,l05,l06,l07,l08,l09,l10}"
MUTANTS="${MUTANTS:-drop swap alter stale skip-live}"
node=(nix shell nixpkgs#nodejs_22 --command node)
mkdir -p "$OUT"
cd "$here"

bundles() {
  bash apply-probes.sh main "$MAIN_TREE" build
  bash apply-probes.sh branch "$BRANCH_TREE" build
  bash union.sh
  bash replica.sh up 2s
}

read_phase() {
  for seed in $SEEDS; do
    "${node[@]}" coord.mjs read --seed "$seed" --out "$OUT/read-$seed"
  done
}

quiet() {
  "${node[@]}" coord.mjs seq --seed "${SEEDS%% *}" --out "$OUT/seq-quiet" --groups "$QUIET_GROUPS" \
    --sequences "$SEQUENCES" --steps "$STEPS" --live-ms "$LIVE_MS"
}

loaded() {
  # load.ts writes into the v1 seed's channels only, never a v2 group's.
  (cd "$here/.." && exec nix shell nixpkgs#bun --command bun proof-v2/load.ts --out "$OUT/load.json") &
  local load=$!
  trap 'kill "$load" 2>/dev/null || true' EXIT
  "${node[@]}" coord.mjs seq --seed "${SEEDS##* }" --out "$OUT/seq-loaded" --groups "$LOADED_GROUPS" \
    --sequences "$SEQUENCES" --steps "$STEPS" --live-ms "$LIVE_MS"
  kill "$load" 2>/dev/null || true
  wait "$load" 2>/dev/null || true
  trap - EXIT
}

mutants() {
  for m in $MUTANTS; do
    "${node[@]}" coord.mjs read --seed "${SEEDS%% *}" --out "$OUT/mutant-$m-read" --viewers small,buckets --mutant "$m"
    "${node[@]}" coord.mjs seq --seed "${SEEDS%% *}" --out "$OUT/mutant-$m-seq" --groups q01 \
      --sequences 1 --steps "$STEPS" --live-ms "$LIVE_MS" --mutant "$m"
  done
}

summary() {
  bash "$here/summarize.sh" "$OUT"
}

case "${1:-all}" in
  all) bundles; read_phase; quiet; loaded; mutants; summary ;;
  bundles) bundles ;;
  read) read_phase ;;
  quiet) quiet ;;
  loaded) loaded ;;
  mutants) mutants ;;
  summary) summary ;;
  *) echo "usage: run.sh [all|bundles|read|quiet|loaded|mutants|summary]" >&2; exit 2 ;;
esac
