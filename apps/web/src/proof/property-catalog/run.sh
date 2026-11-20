#!/usr/bin/env bash
# One command for the property catalog differential.
#
#   apps/web/src/proof/property-catalog/run.sh [all|quiet|load|control|mutants|smoke]
#
# Needs a local stack (`just run_local --instance <name>`) serving the web app
# at $BASE (default https://localhost:24709) from this worktree, and its
# Postgres container in $PG_CONTAINER. Every account it creates is synthetic
# (`pc-*@*.fuzz.test`). Results land in apps/web/src/proof/property-catalog/out/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
OLD_COMMIT="${OLD_COMMIT:-a03c481f726}"
PROPS="$ROOT/apps/web/src/lib/queries/properties"
MODE="${1:-all}"

# The base commit's query modules, served beside the head's; the OLD side of
# the harness swaps them in by URL. Removed again on exit.
cleanup() { rm -f "$PROPS"/definitions.__old__.ts "$PROPS"/options.__old__.ts "$PROPS"/tags.__old__.ts; }
trap cleanup EXIT
for f in definitions options tags; do
  git -C "$ROOT" show "$OLD_COMMIT:apps/web/src/lib/queries/properties/$f.ts" > "$PROPS/$f.__old__.ts"
done

node_run() { (cd "$ROOT" && nix develop --command node "$HERE/run.mjs"); }

case "$MODE" in
  smoke)
    SEED=${SEED:-1} SEQS=1 STEPS=3 LANES=1 SWEEP=0 VOLUME=0 OUT="$HERE/out/smoke" node_run ;;
  mutants)
    for m in drop-row swap-order alter-field stale-cache skip-live-update; do
      SEED=${SEED:-1} MUTANT=$m SEQS=${MUTANT_SEQS:-2} STEPS=${STEPS:-20} LANES=1 SWEEP=0 VOLUME=0 node_run
    done ;;
  control)
    SEED=${SEED:-1} CONTROL=1 SEQS=${SEQS:-40} LANES=${LANES:-4} node_run ;;
  quiet)
    SEED=${SEED:-1} node_run ;;
  load)
    SEED=${SEED:-2} LOAD=${LOAD:-6} node_run ;;
  all)
    SEED=1 OUT="$HERE/out/seed-1" node_run
    SEED=2 LOAD=6 OUT="$HERE/out/seed-2-load" node_run
    SEED=3 CONTROL=1 SEQS=40 VOLUME=500 OUT="$HERE/out/control" node_run
    for m in drop-row swap-order alter-field stale-cache skip-live-update; do
      SEED=1 MUTANT=$m SEQS=2 LANES=1 SWEEP=0 VOLUME=0 node_run
    done ;;
  *) echo "usage: $0 [all|quiet|load|control|mutants|smoke]" >&2; exit 2 ;;
esac
