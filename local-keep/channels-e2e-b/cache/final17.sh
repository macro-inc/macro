#!/usr/bin/env bash
# Final head after the UNR-06 follow-up: rebuild the engine and both bundles, one whole run on, one off.
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final17.log
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
mark "head $(git -C $root rev-parse --short=10 HEAD)"
( \cd $root/apps/web && nix develop -c just build-cache-wasm ) > $d/logs/engine17.log 2>&1 || { mark "ENGINE BUILD FAILED"; exit 1; }
mark "engine built"
$d/build-bundle.sh good || { mark "ON BUNDLE FAILED"; exit 1; }
mark "on bundle built"
FLAG=off $d/build-bundle.sh off || { mark "OFF BUNDLE FAILED"; exit 1; }
mark "off bundle built"
$d/stage.sh good
mark "f17-on-1 start"; RUN_TAG=f17-on-1 $d/run.sh > $d/logs/f17-on-1.log 2>&1; mark "f17-on-1 end"
$d/stage.sh off
mark "f17-off-1 start"; FLAG=off RUN_TAG=f17-off-1 $d/run.sh > $d/logs/f17-off-1.log 2>&1; mark "f17-off-1 end"
$d/stage.sh good
echo ALLDONE17 >> $L
