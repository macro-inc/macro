#!/usr/bin/env bash
# The differential in one command:
#
#   proof/notified-sort/run.sh all       # quiet run, loaded run, every mutant
#   proof/notified-sort/run.sh quiet     # seed base+1, no load
#   proof/notified-sort/run.sh load      # seed base+2, under concurrent load
#   proof/notified-sort/run.sh mutants   # seeds base+10.., one reduced run per planted mutant
#   proof/notified-sort/run.sh test      # the harness unit tests, no stack
#   proof/notified-sort/run.sh smoke     # a few cases, to check the setup
#
# Needs a run_local stack instance (PROOF_INSTANCE, default gqlns) started
# from PROOF_REPO, and two installed worktrees: PROOF_OLD_WORKTREE at the
# branch's merge-base (main's reader) and PROOF_NEW_WORKTREE at the branch
# head (defaults to this checkout). Every seed must be new to the instance:
# sequences change the world they run in. Results land in out/<run>/.
# PROOF_SEED_BASE (default 1100) picks the seeds; PROOF_NOW (ms since epoch,
# recorded in each summary) replays a run's relative date filters exactly.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROOF_NEW_WORKTREE:=$(cd "$here/../.." && pwd)}"
: "${PROOF_REPO:=$PROOF_NEW_WORKTREE}"
if [ "${1:-}" = test ]; then
  exec nix develop "$PROOF_REPO" --command "$PROOF_NEW_WORKTREE/node_modules/.bin/vitest" run --root "$here" --maxWorkers=2
fi
: "${PROOF_OLD_WORKTREE:?set PROOF_OLD_WORKTREE to a worktree at the merge-base}"
export PROOF_NEW_WORKTREE PROOF_REPO PROOF_OLD_WORKTREE
if ! command -v just >/dev/null || ! command -v psql >/dev/null; then
  exec nix develop "$PROOF_REPO" --command bash "${BASH_SOURCE[0]}" "$@"
fi
source "$here/env.sh"
# Both apps load the browser WebAssembly packages their sources generate; a
# worktree that moved since its last build loads stale ones and the app (and
# the probe) fails to import. This is a no-op when they are current.
for tree in "$PROOF_OLD_WORKTREE" "$PROOF_NEW_WORKTREE"; do
  (cd "$tree/apps/web" && bun run dev:prepare >/dev/null)
done
# The browser runs in its own network namespace (lib/chromium-netns.sh) and
# reaches the dev servers through socat.
: "${PROOF_SOCAT:=$(nix build --no-link --print-out-paths nixpkgs#socat)/bin/socat}"
export PROOF_SOCAT
run() { echo "== $*"; env "$@" node "$here/run.ts"; }
seed_base="${PROOF_SEED_BASE:-1100}"
mode="${1:-all}"
case "$mode" in
  smoke)
    run PROOF_SEED=$((seed_base + 0)) PROOF_RUN=smoke PROOF_LANES=2 PROOF_SIZES=0,1,101 PROOF_READS=60 PROOF_SEQUENCES=1 PROOF_STEPS=5 PROOF_DOM=2 PROOF_WORKERS=3 ;;
  quiet)
    run PROOF_SEED=$((seed_base + 1)) PROOF_RUN=quiet PROOF_LANES=24 PROOF_SEQUENCES=5 PROOF_STEPS=20 PROOF_READS=3000 PROOF_WORKERS=8 ;;
  load)
    run PROOF_SEED=$((seed_base + 2)) PROOF_RUN=load PROOF_LOAD=1 PROOF_LANES=24 PROOF_SEQUENCES=4 PROOF_STEPS=20 PROOF_READS=2000 PROOF_WORKERS=8 ;;
  mutants)
    i=10
    for m in baseline drop-row swap-order alter-field stale-cache skip-live; do
      mutant=$m; [ "$m" = baseline ] && mutant=
      run PROOF_SEED=$((seed_base + i)) PROOF_RUN="mutant-$m" PROOF_MUTANT="$mutant" PROOF_LANES=3 PROOF_SIZES=0,101 PROOF_READS=250 PROOF_SEQUENCES=1 PROOF_STEPS=20 PROOF_DOM=1 || true
      i=$((i + 1))
    done ;;
  all)
    "$0" quiet && "$0" load && "$0" mutants ;;
  *) echo "unknown mode $mode" >&2; exit 2 ;;
esac
node "$here/report.ts" || true
