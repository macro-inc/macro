#!/usr/bin/env bash
# control4.sh: after final4, the probe runs again without the network namespace, where the browser reports itself online.
d=$HOME/.cache/channels-e2e-b; w=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b; L=$d/logs/final4.log
until grep -q "ALLDONE4\|FAILED\|DIRTY" $L; do sleep 20; done
grep -q ALLDONE4 $L || exit 1
\cd $w && git apply $d/probe4.patch || exit 1
for n in 1 2; do
  echo "open4-$n start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L
  CHANNELS_E2E_COPIES=6 RUN_TAG=open4-$n $d/run-open.sh > $d/logs/open4-$n.log 2>&1
  echo "open4-$n end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L
done
git apply -R $d/probe4.patch
echo CONTROLDONE4 >> $L
