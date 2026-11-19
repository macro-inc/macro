#!/usr/bin/env bash
# breaks3.sh: rebuild every device break on the current head and run the tests each one proves.
d=$HOME/.cache/channels-e2e-b; b=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/ledger/breaks
mv $d/breaks/results.tsv $d/breaks/results-before-63e04.tsv 2>/dev/null
$d/rerun-break.sh queued-writes-never-sent "WRT-01|WRT-03|WRT-04|WRT-08|WRT-12|WRT-13"
$d/break.sh $b/device-not-used.patch "OFF-01|OFF-0[4-9]|OFF-1[01]|PRE-01|WRT-02|WRT-05|WRT-06|WRT-07|WRT-14"
$d/break.sh $b/channel-changes-not-applied.patch "SYN-01|SYN-03|SYN-05|OFF-03"
$d/break.sh $b/changes-reach-neither-screen-nor-device.patch "SYN-02"
$d/break.sh $b/held-channel-shown-as-it-was-left.patch "SYN-04|SYN-06|SYN-09|SYN-10"
$d/break.sh $b/no-access-shown-as-unavailable.patch "SYN-08"
$d/break.sh $b/channel-load-error-not-shown.patch "OFF-02"
$d/break.sh $b/refused-write-kept.patch "WRT-09"
$d/break.sh $b/waiting-message-not-marked.patch "WRT-10|WRT-11"
echo BREAKSDONE >> $d/logs/breaks3.log
