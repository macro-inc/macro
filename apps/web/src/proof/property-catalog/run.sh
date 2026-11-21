#!/usr/bin/env bash
# One command for the property catalog differential.
#
#   apps/web/src/proof/property-catalog/run.sh [all | smoke | quiet | load | seed4 | control | mutants ...]
#
# `all` runs, in order: the mutants (a clean baseline, then five planted
# faults), seed 1 quiet, seed 2 under load, seed 4 quiet, and the old-vs-old
# control. Several modes may be given. Exits non-zero if a run crashed, a lane
# died, the OLD page did not run the base commit's modules, or a mutant was
# not caught.
#
# Needs a local stack (`just run_local --instance <name>`) serving the web app
# at $BASE (default https://localhost:24709) from this worktree, and its
# Postgres container in $PG_CONTAINER. Every account it creates is synthetic
# (`pc-*@*.fuzz.test`). Results land in apps/web/src/proof/property-catalog/out/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
export OLD_COMMIT="${OLD_COMMIT:-a03c481f726}"
PROPS="$ROOT/apps/web/src/lib/queries/properties"
MODES=("${@:-all}")

# The base commit's query modules, served beside the head's; the OLD side of
# the harness swaps them in by URL. Each carries a marker the runner reads
# back from the page, so a swap that did not happen fails the run. Removed
# again on exit.
cleanup() { rm -f "$PROPS"/definitions.__old__.ts "$PROPS"/options.__old__.ts "$PROPS"/tags.__old__.ts; }
trap cleanup EXIT
for f in definitions options tags; do
  {
    git -C "$ROOT" show "$OLD_COMMIT:apps/web/src/lib/queries/properties/$f.ts"
    printf "\nexport const __PROOF_MODULE__ = 'old:%s';\n" "$OLD_COMMIT"
  } > "$PROPS/$f.__old__.ts"
done

FAILED=()
node_run() {
  local name="$1"
  if ! (cd "$ROOT" && nix develop --command node "$HERE/run.mjs"); then
    FAILED+=("$name")
  fi
}

run_mode() {
  case "$1" in
    smoke)
      SEED=${SEED:-1} SEQS=1 STEPS=3 LANES=1 SWEEP=0 VOLUME=0 OUT="$HERE/out/smoke" node_run smoke ;;
    quiet)
      SEED=1 OUT="$HERE/out/seed-1" node_run quiet ;;
    load)
      SEED=2 LOAD=6 OUT="$HERE/out/seed-2-load" node_run load ;;
    seed4)
      SEED=4 SEQS=100 VOLUME=0 OUT="$HERE/out/seed-4" node_run seed4 ;;
    control)
      SEED=3 CONTROL=1 SEQS=40 VOLUME=500 OUT="$HERE/out/control" node_run control ;;
    mutants)
      # The clean run the mutants are measured against: same seed and shape,
      # no fault. A mutant counts as caught only at a difference this run
      # does not have.
      SEED=1 SEQS=2 LANES=1 SWEEP=0 VOLUME=0 OUT="$HERE/out/mutant-baseline" node_run mutant-baseline
      for m in drop-row swap-order alter-field stale-cache skip-live-update; do
        SEED=1 SEQS=2 LANES=1 SWEEP=0 VOLUME=0 MUTANT=$m BASELINE="$HERE/out/mutant-baseline/results.json" \
          OUT="$HERE/out/mutant-$m" node_run "mutant-$m"
      done ;;
    all)
      for m in mutants quiet load seed4 control; do run_mode $m; done ;;
    *) echo "usage: $0 [all | smoke | quiet | load | seed4 | control | mutants ...]" >&2; exit 2 ;;
  esac
}
for m in "${MODES[@]}"; do run_mode "$m"; done
if ((${#FAILED[@]})); then
  echo "failed: ${FAILED[*]}" >&2
  exit 1
fi
