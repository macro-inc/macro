#!/usr/bin/env bash
# Takes over from chain-6: waits for its v9 tune run, then out-of-sight
# routines sessions (unseen) on tune, then main on tune twice and climb4.
# The candidate's climb4 run is left for after unseen is judged.
set -u
cd "${WORKTREE:?set WORKTREE to the climb worktree}"
S="${SCRATCH:?set SCRATCH to a folder for logs}"
BENCH="nix develop --command bun crates/suggestion_generation/bench/bench.ts"
BASE=$(git merge-base origin/main HEAD)
build() {
  nix develop --command just run_local rebuild --instance sugclimb > $S/rebuild-$1.log 2>&1
  for i in $(seq 1 180); do st=$(grep -o '"status": "[a-z]*"' infra/local/generated/sugclimb/run/job.json | head -1); case "$st" in *running*) sleep 10;; *) break;; esac; done
  for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:22526/health); [ "$c" = 200 ] && break; sleep 10; done
  echo "$1 build $st health=$c leg1=$(grep -a -c 'paperwork completed that they pass on' target/debug/agent_harness_service) v9=$(grep -a -c 'mail awaiting their answer catches' target/debug/agent_harness_service) $(date +%H:%M)"
}
run() { # label set
  $BENCH run routines --set $2 --label $1 --instance sugclimb > $S/run-$1-$2.log 2>&1
  echo "$1 $2: $(grep '^| routines' $S/run-$1-$2.log) $(date +%H:%M)"
}
# (waited here for the previous chain's bench pid)
echo "v9 tune: $(grep '^| routines' $S/run-v9-tune.log) $(date +%H:%M)"
git merge --ff-only synoet/routines-suggestions-unseen > /dev/null && echo "unseen merged: $(git rev-parse --short=11 HEAD)"
build unseen
run unseen tune
FILES=$(git diff --name-only $BASE HEAD | grep -v '^crates/suggestion_generation/bench/')
git checkout $BASE -- $FILES
build main
run main tune
run main-b tune
run main climb4
git checkout HEAD -- $FILES
echo "restored: $(git status --short | wc -l) changed files $(date +%H:%M)"
