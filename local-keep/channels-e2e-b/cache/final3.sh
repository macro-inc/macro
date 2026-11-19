#!/usr/bin/env bash
# final.sh: the whole marked suite alone on the fixed build: five runs flag on, then one flag off.
d=$HOME/.cache/channels-e2e-b
$d/stage.sh good
for n in 1 2 3 4 5; do
  echo "f3-on-$n start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final3.log
  RUN_TAG=f3-on-$n $d/run.sh > $d/logs/f3-on-$n.log 2>&1
  echo "f3-on-$n end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg) exit $?" >> $d/logs/final3.log
done
$d/stage.sh off
echo "f3-off-1 start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final3.log
FLAG=off RUN_TAG=f3-off-1 $d/run.sh > $d/logs/f3-off-1.log 2>&1
echo "f3-off-1 end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/final3.log
$d/stage.sh good
echo ALLDONE3 >> $d/logs/final3.log
