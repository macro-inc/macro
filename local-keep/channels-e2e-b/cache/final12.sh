#!/usr/bin/env bash
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final11.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
$d/stage.sh good
mark "f14-on-1 start"; RUN_TAG=f14-on-1 $d/run.sh > $d/logs/f14-on-1.log 2>&1; mark "f14-on-1 end"
$d/stage.sh off
mark "f14-off-1 start"; FLAG=off RUN_TAG=f14-off-1 $d/run.sh > $d/logs/f14-off-1.log 2>&1; mark "f14-off-1 end"
$d/stage.sh good
echo ALLDONE14 >> $L
