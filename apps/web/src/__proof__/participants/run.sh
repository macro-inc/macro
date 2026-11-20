#!/usr/bin/env bash
# One command for the whole participants differential against a running local
# stack (see README.md). With no arguments it runs, in order:
#   1. the check that main/ holds main's code verbatim;
#   2. seeds 1 and 2, each once quiet and once under concurrent load (50
#      sequences of 24 steps each by default: 200 sequences in all);
#   3. one run per planted mutant, each of which must be caught;
#   4. case 37 on purpose (faults on each read, under load and not);
# and prints a summary per run. Results go to $PX_ROOT (default
# /tmp/px-<timestamp>). Every knob of driver/run.ts is an env var: PX_SEQS,
# PX_STEPS, PX_BATCH, PX_LIVE_MS, PX_ORIGIN, PX_PG, PX_REDIS.
#
#   ./run.sh                 # everything
#   ./run.sh differential    # the four seed runs only
#   ./run.sh mutants         # the five mutants only
#   ./run.sh case37          # case 37 only
#
# Edit nothing under apps/web/src while it runs: Vite reloads the open pages
# when a module they import changes, which ends the run.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
root=${PX_ROOT:-/tmp/px-$(date +%Y%m%d-%H%M%S)}
what=${1:-all}
mkdir -p "$root"
cd "$repo"

bun_run() { nix develop --command bun "$@"; }

echo "head $(git rev-parse HEAD) -> $root"
"$here/check-copies.sh"

differential() {
  for seed in ${PX_SEEDS:-1 2}; do
    for load in ${PX_LOADS:-0 1}; do
      PX_SEED=$seed PX_LOAD=$load PX_SEQS=${PX_SEQS:-50} PX_STEPS=${PX_STEPS:-24} PX_BATCH=${PX_BATCH:-50} \
        PX_RUN=s${seed}$([[ $load == 1 ]] && echo l || echo q)$(date +%s | tail -c 5) \
        PX_OUT="$root/seed$seed-$([[ $load == 1 ]] && echo load || echo quiet)" \
        bun_run "$here/driver/run.ts"
    done
  done
}

mutants() {
  for mutant in drop-row swap-order alter-field stale-cache skip-live; do
    PX_SEED=3 PX_MUTANT=$mutant PX_SEQS=${PX_MUTANT_SEQS:-24} PX_STEPS=${PX_MUTANT_STEPS:-6} PX_BATCH=24 \
      PX_RUN=m${mutant%%-*}$(date +%s | tail -c 5) PX_OUT="$root/mutant-$mutant" \
      bun_run "$here/driver/run.ts"
  done
}

case37() {
  PX_OUT="$root/case37" bun_run "$here/driver/case37.ts"
}

case $what in
  all) differential; mutants; case37 ;;
  differential) differential ;;
  mutants) mutants ;;
  case37) case37 ;;
  *) echo "unknown: $what" >&2; exit 2 ;;
esac
bun_run "$here/driver/report.ts" "$root"
