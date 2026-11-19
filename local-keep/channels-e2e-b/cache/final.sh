#!/usr/bin/env bash
# final.sh: the whole marked suite alone on the fixed build: five runs flag on, then one flag off.
d=$HOME/.cache/channels-e2e-b
$d/stage.sh good
for n in 1 2 3 4 5; do
  echo "fix-on-$n start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final.log
  RUN_TAG=fix-on-$n $d/run.sh > $d/logs/fix-on-$n.log 2>&1
  echo "fix-on-$n end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg) exit $?" >> $d/logs/final.log
done
$d/stage.sh off
echo "fix-off-1 start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final.log
FLAG=off RUN_TAG=fix-off-1 $d/run.sh > $d/logs/fix-off-1.log 2>&1
echo "fix-off-1 end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final.log
$d/stage.sh good
echo ALLDONE >> $d/logs/final.log
