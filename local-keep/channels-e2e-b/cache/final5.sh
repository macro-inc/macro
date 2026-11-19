#!/usr/bin/env bash
# final5.sh: on the merge of 94876dc650 with a fresh engine. Probe runs, five clean whole runs on, one off, old-step device run, device break proofs.
d=$HOME/.cache/channels-e2e-b; w=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b; L=$d/logs/final5.log
b=$w/apps/web/tests/channels-e2e/ledger/breaks
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
\cd $w
test -z "$(git status --short)" || { echo "TREE DIRTY AT START" >> $L; exit 1; }
$d/build-bundle.sh good && FLAG=off $d/build-bundle.sh off || { echo "BUILD FAILED" >> $L; exit 1; }
$d/stage.sh good
git apply $d/probe4.patch || { echo "PROBE PATCH FAILED" >> $L; exit 1; }
for n in 1 2 3 4 5; do
  mark "p5-$n start"; CHANNELS_E2E_COPIES=6 RUN_TAG=p5-$n $d/run.sh > $d/logs/p5-$n.log 2>&1; mark "p5-$n end"
done
git apply -R $d/probe4.patch || { echo "REVERT FAILED" >> $L; exit 1; }
test -z "$(git status --short)" || { echo "TREE DIRTY" >> $L; exit 1; }
for n in 1 2 3 4 5; do
  mark "f5-on-$n start"; RUN_TAG=f5-on-$n $d/run.sh > $d/logs/f5-on-$n.log 2>&1; mark "f5-on-$n end"
done
$d/stage.sh off
mark "f5-off-1 start"; FLAG=off RUN_TAG=f5-off-1 $d/run.sh > $d/logs/f5-off-1.log 2>&1; mark "f5-off-1 end"
$d/stage.sh good
git checkout e5c44e3970 -- apps/web/tests/channels-e2e
mark "old5 start"; RUN_TAG=old5 $d/run.sh --trace on --repeat-each 5 writes.spec.ts offline.spec.ts current.spec.ts prewarm.spec.ts > $d/logs/old5.log 2>&1; mark "old5 end"
git checkout HEAD -- apps/web/tests/channels-e2e
test -z "$(git status --short)" || { echo "TREE DIRTY AFTER OLD" >> $L; exit 1; }
mv $d/breaks/results.tsv $d/breaks/results-stale-engine.tsv
mark "breaks start"
$d/break.sh $b/queued-writes-never-sent.patch "WRT-01|WRT-03|WRT-04|WRT-08|WRT-12|WRT-13"
$d/break.sh $b/device-not-used.patch "OFF-01|OFF-0[4-9]|OFF-1[01]|PRE-01|WRT-02|WRT-05|WRT-06|WRT-07"
$d/break.sh $b/channel-changes-not-applied.patch "SYN-01|SYN-03|SYN-05|OFF-03"
$d/break.sh $b/changes-reach-neither-screen-nor-device.patch "SYN-01|SYN-02|SYN-03"
$d/break.sh $b/held-channel-shown-as-it-was-left.patch "SYN-04|SYN-06|SYN-09|SYN-10"
$d/break.sh $b/no-access-shown-as-unavailable.patch "SYN-08"
$d/break.sh $b/channel-load-error-not-shown.patch "OFF-02"
$d/break.sh $b/refused-write-kept.patch "WRT-09"
$d/break.sh $b/waiting-message-not-marked.patch "WRT-10|WRT-11"
$d/break.sh $b/waiting-write-not-shown-in-other-window.patch "WRT-14"
mark "breaks end"
test -z "$(git status --short)" || echo "TREE DIRTY AFTER BREAKS" >> $L
echo ALLDONE5 >> $L
