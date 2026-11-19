#!/usr/bin/env bash
# final11.sh: on che2e-by. Ten whole runs flag on, four tests thirty times inside a mix with traces, three whole runs flag off, then main's merge-base bundle (flag on) for the same four.
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final11.log
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
$d/stage.sh good
for i in 1 2 3 4 5 6 7 8 9 10; do mark "f11-on-$i start"; RUN_TAG=f11-on-$i $d/run.sh > $d/logs/f11-on-$i.log 2>&1; mark "f11-on-$i end"; done
mark "r11-on start"; RUN_TAG=r11-on $d/run.sh -g "CHN-|MEM-|OFF-04|OFF-12" --repeat-each 30 --trace on > $d/logs/r11-on.log 2>&1; mark "r11-on end"
$d/stage.sh off
for i in 1 2 3; do mark "f11-off-$i start"; FLAG=off RUN_TAG=f11-off-$i $d/run.sh > $d/logs/f11-off-$i.log 2>&1; mark "f11-off-$i end"; done
if [ -f $d/bundles/mainmb-on/index.html ]; then
  $d/stage.sh mainmb-on
  mark "r11-main start"; RUN_TAG=r11-main $d/run.sh -g "CHN-|MEM-|OFF-04|OFF-12" --repeat-each 30 --trace on > $d/logs/r11-main.log 2>&1; mark "r11-main end"
fi
$d/stage.sh good
echo ALLDONE11 >> $L
