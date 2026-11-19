#!/usr/bin/env bash
# Round on ce183ced7f: 5 whole runs local sync on, 3 off, then 30 repeats of OFF-06, OFF-09, OFF-13 and of OFF-14, on.
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final15.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
$d/stage.sh good
for i in 1 2 3 4 5; do mark "f15-on-$i start"; RUN_TAG=f15-on-$i $d/run.sh > $d/logs/f15-on-$i.log 2>&1; mark "f15-on-$i end"; done
$d/stage.sh off
for i in 1 2 3; do mark "f15-off-$i start"; FLAG=off RUN_TAG=f15-off-$i $d/run.sh > $d/logs/f15-off-$i.log 2>&1; mark "f15-off-$i end"; done
$d/stage.sh good
mark "r15 start"; RUN_TAG=r15 $d/run.sh -g "OFF-06|OFF-09|OFF-13" --repeat-each 30 --trace retain-on-failure > $d/logs/r15.log 2>&1; mark "r15 end"
mark "r15b start"; RUN_TAG=r15b $d/run.sh -g "OFF-14" --repeat-each 30 --trace retain-on-failure > $d/logs/r15b.log 2>&1; mark "r15b end"
echo ALLDONE15 >> $L
