#!/usr/bin/env bash
# final4.sh: on the merge of 04adb57188. Probe runs (whole suite, six copies of WRT-04, MSG-13, CMP-13, console captured),
# then five clean whole runs flag on, one flag off, then the device tests as they were before the offline step changed.
d=$HOME/.cache/channels-e2e-b; w=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b; L=$d/logs/final4.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
\cd $w
$d/stage.sh good
for n in 1 2 3 4 5; do
  mark "p4-$n start"; CHANNELS_E2E_COPIES=6 RUN_TAG=p4-$n $d/run.sh > $d/logs/p4-$n.log 2>&1; mark "p4-$n end"
done
git apply -R $d/probe4.patch || { echo "REVERT FAILED" >> $L; exit 1; }
test -z "$(git status --short)" || { echo "TREE DIRTY" >> $L; exit 1; }
for n in 1 2 3 4 5; do
  mark "f4-on-$n start"; RUN_TAG=f4-on-$n $d/run.sh > $d/logs/f4-on-$n.log 2>&1; mark "f4-on-$n end"
done
$d/stage.sh off
mark "f4-off-1 start"; FLAG=off RUN_TAG=f4-off-1 $d/run.sh > $d/logs/f4-off-1.log 2>&1; mark "f4-off-1 end"
$d/stage.sh good
git checkout e5c44e3970 -- apps/web/tests/channels-e2e
mark "old4 start"; RUN_TAG=old4 $d/run.sh --trace on --repeat-each 5 writes.spec.ts offline.spec.ts current.spec.ts prewarm.spec.ts > $d/logs/old4.log 2>&1; mark "old4 end"
git checkout HEAD -- apps/web/tests/channels-e2e
test -z "$(git status --short)" || echo "TREE DIRTY AFTER OLD" >> $L
echo ALLDONE4 >> $L
