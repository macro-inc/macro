#!/usr/bin/env bash
# final10.sh: CHN, MEM and OFF-04 thirty times each together, flag on; then ten times flag off; then one whole run each.
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final10.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
$d/stage.sh good
mark "r10-on start"; RUN_TAG=r10-on $d/run.sh -g "CHN-|MEM-|OFF-04" --repeat-each 30 > $d/logs/r10-on.log 2>&1; mark "r10-on end"
mark "f10-on-1 start"; RUN_TAG=f10-on-1 $d/run.sh > $d/logs/f10-on-1.log 2>&1; mark "f10-on-1 end"
$d/stage.sh off
mark "r10-off start"; FLAG=off RUN_TAG=r10-off $d/run.sh -g "CHN-|MEM-" --repeat-each 10 > $d/logs/r10-off.log 2>&1; mark "r10-off end"
mark "f10-off-1 start"; FLAG=off RUN_TAG=f10-off-1 $d/run.sh > $d/logs/f10-off-1.log 2>&1; mark "f10-off-1 end"
$d/stage.sh good
echo ALLDONE10 >> $L
