#!/usr/bin/env bash
# Records the review check-in request for one view and mode, resetting the workspace before
# each try (the bench's reset: routines deleted, statuses restored). On the branch it retries a
# fresh draft until the task change schedules a copy, the copy shows the definition edit and its
# run by hand replies with it. Failed tries are kept as <dir>.tryN.
# usage: rec4.sh <desktop|phone> <before|after>
set -u
view=$1 mode=$2
\cd ~/.cache/routines-draft-subroutines/ui
export TMPDIR=$HOME/.cache/pw
E=$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines
dir=rec4-$mode-$view
edit=$([ "$mode" = after ] && echo 1 || echo 0)
tries=$([ "$mode" = after ] && echo 8 || echo 3)
for n in $(seq 1 ${TRIES:-$tries}); do
  rm -rf $dir
  timeout 600 nix develop $E --command bash -c "bun reset.ts" 2>&1 | grep -v "Git tree\|rmeta" | sed 's/eyJ[A-Za-z0-9._-]*/<token>/g' | tail -1
  timeout 1500 nix develop $E --command bash -c "MODE=$mode VIEW=$view EDIT=$edit bun record3.ts > $dir.log 2>&1" 2>/dev/null
  if [ "$mode" = after ]; then
    ok=$(jq -r '((.createdInRun // 0) > 0 and (.copyUrl != null) and ((.copyAfterEditText // "") | test("Heads up")) and ((.copyRunDetail // "") | test("Heads up")) and (.error == null))' $dir/facts.json 2>/dev/null)
  else
    ok=$(jq -r '((.parentRun // "") | test("Succeeded|Failed|Skipped")) and (.error == null)' $dir/facts.json 2>/dev/null)
  fi
  echo "try $n $(date -u +%T) ok=$ok $(grep -h 'parent run finished' $dir.log | head -1 | cut -c1-200)"
  [ "$ok" = true ] && break
  rm -rf $dir.try$n; mv $dir $dir.try$n; mv $dir.log $dir.try$n.log
done
echo "== done $mode $view"
