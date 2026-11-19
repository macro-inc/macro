#!/usr/bin/env bash
# break-queue.sh <pattern> <patch names...>: run breaks one after another, after any break already running.
pattern=$1; shift
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
while pgrep -f 'channels-e2e/break.sh' >/dev/null; do sleep 15; done
for n in "$@"; do
  ~/.cache/channels-e2e/break.sh apps/web/tests/channels-e2e/ledger/breaks/$n.patch "$pattern" > ~/.cache/channels-e2e/breaks/$n.tsv 2>&1
  echo "$n: $(grep FAILED ~/.cache/channels-e2e/breaks/$n.tsv | cut -f2 | tr '\n' ' ')"
done
git status --short apps/web/src
