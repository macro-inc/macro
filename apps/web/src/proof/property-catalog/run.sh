#!/usr/bin/env bash
# One command for the property catalog differential.
#
#   apps/web/src/proof/property-catalog/run.sh [all | smoke | quiet | load | seed4 | control | mutants | optimism ...]
#
# `all` runs, in order: the mutants (a clean baseline, then five planted
# faults), seed 1 quiet, seed 2 under load, seed 4 quiet, and the old-vs-old
# control, then the optimistic states (pending, failed, offline, two tabs).
# Several modes may be given. Exits non-zero if a run crashed, a lane died,
# the OLD page did not run the base commit's modules, a mutant was not
# caught, or an optimistic-state check failed.
#
# Needs a local stack (`just run_local --instance <name>`) serving the web app
# at $BASE (default https://localhost:24709) from this worktree, and its
# Postgres container in $PG_CONTAINER. Every account it creates is synthetic
# (`pc-*@*.fuzz.test`). Results land in apps/web/src/proof/property-catalog/out/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../../.." && pwd)"
# Resolved to the full commit, so a branch name that later moves is never
# mistaken for the same old side.
OLD_COMMIT="$(git -C "$ROOT" rev-parse --verify "${OLD_COMMIT:-c8b5760036c}^{commit}")"
export OLD_COMMIT
MODES=("${@:-all}")
# The run shape comes from each mode below, never from the caller's
# environment; only smoke takes SEED and MUTANT from it.
SMOKE_SEED="${SEED:-1}"
SMOKE_MUTANT="${MUTANT:-}"
unset SEED SEQS STEPS LANES ROTATE READS_PER_STEP SWEEP VOLUME LOAD CONTROL MUTANT MUTANT_RATE BASELINE SETTLE_MS STOP_ON_CATCH OPTIMISM OUT

# Every run this invocation will make, cleared before anything else can fail:
# a mode that never starts reads INCOMPLETE, never as an earlier pass.
MUTANTS=(drop-row swap-order alter-field stale-cache skip-live-update)
outs_for() {
  case "$1" in
    smoke) echo smoke ;;
    quiet) echo seed-1 ;;
    load) echo seed-2-load ;;
    seed4) echo seed-4 ;;
    control) echo control ;;
    optimism) echo optimism ;;
    mutants) echo mutant-baseline; for m in "${MUTANTS[@]}"; do echo "mutant-$m"; done ;;
    all) for m in mutants quiet load seed4 control optimism; do outs_for "$m"; done ;;
    *) echo "usage: $0 [all | smoke | quiet | load | seed4 | control | mutants | optimism ...]" >&2; return 2 ;;
  esac
}
# Every mode is checked before any result is removed.
PLANNED=()
for m in "${MODES[@]}"; do
  dirs=$(outs_for "$m") || exit 2
  PLANNED+=($dirs)
done
# Each one is attempted even after one fails, so no planned run keeps an old
# verdict; then a failure stops the launch.
UNCLEARED=()
for d in "${PLANNED[@]}"; do
  { mkdir -p "$HERE/out/$d" && rm -f "$HERE/out/$d/results.json" && date -Is > "$HERE/out/$d/started"; } ||
    UNCLEARED+=("$d")
done
if ((${#UNCLEARED[@]})); then
  echo "cannot clear out/: ${UNCLEARED[*]}" >&2
  exit 1
fi

# The base commit's copy of every web module the PR changed, served beside
# the head's: the OLD side of the harness swaps each in by URL, so OLD runs
# main's web code end to end. Tests and browser fixtures never load on the
# page; this directory is the harness itself. Each copy carries a marker the
# runner reads back from the page, so a swap that did not happen fails the
# run. The list goes to out/old-modules.json for the runner's route; the
# copies are removed again on exit.
OLD_LIST="$HERE/out/old-modules.json"
mapfile -t CHANGED < <(git -C "$ROOT" diff --name-only --diff-filter=M "$OLD_COMMIT" HEAD -- apps/web/src \
  ':(exclude)apps/web/src/proof/**' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/browser-test/**')
if ((${#CHANGED[@]} == 0)); then echo "no changed web modules against $OLD_COMMIT" >&2; exit 1; fi
old_copy() { local f="$1"; echo "${f%.*}.__old__.${f##*.}"; }
cleanup() { for f in "${CHANGED[@]}"; do rm -f "$ROOT/$(old_copy "$f")"; done; }
trap cleanup EXIT
for f in "${CHANGED[@]}"; do
  {
    git -C "$ROOT" show "$OLD_COMMIT:$f"
    printf "\nexport const __PROOF_MODULE__ = 'old:%s';\n" "$OLD_COMMIT"
  } > "$ROOT/$(old_copy "$f")"
done
printf '%s\n' "${CHANGED[@]}" | sed 's#^apps/web##' | jq -R . | jq -s . > "$OLD_LIST"
echo "OLD side: ${#CHANGED[@]} modules from $OLD_COMMIT (out/old-modules.json)"

FAILED=()
node_run() {
  local name="$1"
  # Before Node starts, so a run that never gets that far leaves no earlier
  # result behind: summarize reads it as INCOMPLETE from the marker.
  if ! { mkdir -p "$OUT" && rm -f "$OUT/results.json" "$OUT/dump.jsonl" && date -Is > "$OUT/started"; }; then
    FAILED+=("$name"); return
  fi
  if ! (cd "$ROOT" && nix develop --command node "$HERE/run.mjs"); then
    FAILED+=("$name")
  fi
}

run_mode() {
  case "$1" in
    smoke)
      SEED=$SMOKE_SEED MUTANT=$SMOKE_MUTANT SEQS=1 STEPS=3 LANES=1 SWEEP=0 VOLUME=0 OUT="$HERE/out/smoke" node_run smoke ;;
    quiet)
      MUTANT= BASELINE= SEED=1 OUT="$HERE/out/seed-1" node_run quiet ;;
    load)
      MUTANT= BASELINE= SEED=2 LOAD=6 OUT="$HERE/out/seed-2-load" node_run load ;;
    seed4)
      MUTANT= BASELINE= SEED=4 SEQS=100 VOLUME=0 OUT="$HERE/out/seed-4" node_run seed4 ;;
    control)
      MUTANT= BASELINE= SEED=3 CONTROL=1 SEQS=40 VOLUME=500 OUT="$HERE/out/control" node_run control ;;
    mutants)
      # The clean run the mutants are measured against: same seed and shape,
      # no fault. A mutant counts as caught only at a difference this run
      # does not have.
      MUTANT= BASELINE= SEED=1 SEQS=2 LANES=1 SWEEP=0 VOLUME=0 OUT="$HERE/out/mutant-baseline" node_run mutant-baseline
      # run.mjs also refuses a baseline without a passing verdict
      if [[ " ${FAILED[*]} " == *" mutant-baseline "* ]]; then echo "baseline failed; mutants not run" >&2; return; fi
      for m in "${MUTANTS[@]}"; do
        SEED=1 SEQS=2 LANES=1 SWEEP=0 VOLUME=0 MUTANT=$m BASELINE="$HERE/out/mutant-baseline/results.json" \
          OUT="$HERE/out/mutant-$m" node_run "mutant-$m"
      done ;;
    optimism)
      MUTANT= BASELINE= SEED=1 OPTIMISM=1 SEQS=0 LANES=0 SWEEP=0 VOLUME=0 OUT="$HERE/out/optimism" node_run optimism ;;
    all)
      for m in mutants quiet load seed4 control optimism; do run_mode $m; done ;;
    *) echo "usage: $0 [all | smoke | quiet | load | seed4 | control | mutants | optimism ...]" >&2; exit 2 ;;
  esac
}
for m in "${MODES[@]}"; do run_mode "$m"; done
if ((${#FAILED[@]})); then
  echo "failed: ${FAILED[*]}" >&2
  exit 1
fi
