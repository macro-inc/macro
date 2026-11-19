#!/usr/bin/env bash
# Final head after the fifth merge of base and main: rebuild the engine and both bundles, one whole run on, one off.
d=$HOME/.cache/channels-e2e-b; L=$d/logs/final21.log
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
mark() { echo "$1 $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $L; }
mark "head $(git -C $root rev-parse --short=10 HEAD)"
( \cd $root && nix develop -c just stack update --instance che2e-by --no-doppler --env-file $d/stack.env --json ) > $d/logs/stackupdate21.log 2>&1 || { mark "STACK UPDATE FAILED"; exit 1; }
mark "services updated"
( \cd $root/apps/web && nix develop -c just build-cache-wasm ) > $d/logs/engine21.log 2>&1 || { mark "ENGINE BUILD FAILED"; exit 1; }
mark "engine built"
$d/build-bundle.sh good || { mark "ON BUNDLE FAILED"; exit 1; }
mark "on bundle built"
FLAG=off $d/build-bundle.sh off || { mark "OFF BUNDLE FAILED"; exit 1; }
mark "off bundle built"
$d/stage.sh good
mark "f21-on-1 start"; RUN_TAG=f21-on-1 $d/run.sh > $d/logs/f21-on-1.log 2>&1; mark "f21-on-1 end"
$d/stage.sh off
mark "f21-off-1 start"; FLAG=off RUN_TAG=f21-off-1 $d/run.sh > $d/logs/f21-off-1.log 2>&1; mark "f21-off-1 end"
$d/stage.sh good
echo ALLDONE21 >> $L
