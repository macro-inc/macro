#!/usr/bin/env bash
# older-breaks.sh: rebuild every non-device break on the current head (fresh engine, flag on) and run the tests it proves.
d=$HOME/.cache/channels-e2e-b; b=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/ledger/breaks
dev="queued-writes-never-sent|device-not-used|channel-changes-not-applied|changes-reach-neither-screen-nor-device|held-channel-shown-as-it-was-left|no-access-shown-as-unavailable|channel-load-error-not-shown|refused-write-kept|waiting-message-not-marked|waiting-write-not-shown-in-other-window"
cp $d/breaks/results.tsv $d/breaks/results-device-fresh.tsv; : > $d/breaks/results.tsv
echo "start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/older-breaks.log
grep -vE "^($dev)	" $d/break-map.tsv | while IFS=$'\t' read -r name tests; do
  [ -e $d/stop-breaks ] && break
  $d/break.sh $b/$name.patch "$tests" >> $d/logs/older-breaks.log 2>&1 < /dev/null
  rm -rf $d/bundles/break-$name/*.map
done
$d/rerun-break.sh no-access-shown-as-unavailable "ACC-01|ACC-02|ACC-07|MEM-04" >> $d/logs/older-breaks.log 2>&1
echo "end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $d/logs/older-breaks.log
echo OLDERDONE >> $d/logs/older-breaks.log
