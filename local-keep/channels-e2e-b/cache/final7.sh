#!/usr/bin/env bash
# final7.sh: fifteen more whole-suite runs flag on and four flag off, on the merge of 94876dc650, alone on my stack.
d=$HOME/.cache/channels-e2e-b; w=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b; L=$d/logs/final7.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
\cd $w
$d/stage.sh good
for n in $(seq 6 20); do
  [ -e $d/stop7 ] && break
  mark "f7-on-$n start"; RUN_TAG=f7-on-$n $d/run.sh > $d/logs/f7-on-$n.log 2>&1; mark "f7-on-$n end"
done
$d/stage.sh off
for n in 2 3 4 5; do
  [ -e $d/stop7 ] && break
  mark "f7-off-$n start"; FLAG=off RUN_TAG=f7-off-$n $d/run.sh > $d/logs/f7-off-$n.log 2>&1; mark "f7-off-$n end"
done
$d/stage.sh good
echo ALLDONE7 >> $L
