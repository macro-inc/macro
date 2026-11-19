#!/usr/bin/env bash
# final9.sh: fifteen more whole-suite runs flag on and four flag off, on the merge of 94876dc650, alone on my stack.
d=$HOME/.cache/channels-e2e-b; w=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b; L=$d/logs/final9.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
\cd $w
$d/stage.sh good
for n in $(seq 1 6); do
  [ -e $d/stop9 ] && break
  mark "f9-on-$n start"; RUN_TAG=f9-on-$n $d/run.sh > $d/logs/f9-on-$n.log 2>&1; mark "f9-on-$n end"
done
$d/stage.sh off
for n in 2; do
  [ -e $d/stop9 ] && break
  mark "f9-off-$n start"; FLAG=off RUN_TAG=f9-off-$n $d/run.sh > $d/logs/f9-off-$n.log 2>&1; mark "f9-off-$n end"
done
$d/stage.sh good
echo ALLDONE9 >> $L
