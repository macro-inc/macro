#!/usr/bin/env bash
# breaks7.sh: new break proofs, reruns of breaks whose tests passed, then the same older breaks built flag off.
d=$HOME/.cache/channels-e2e-b; b=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/apps/web/tests/channels-e2e/ledger/breaks
log=$d/logs/breaks7.log
echo "start $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $log
while IFS=$'\t' read -r name tests; do
  $d/break.sh $b/$name.patch "$tests" >> $log 2>&1 < /dev/null; rm -rf $d/bundles/break-$name/*.map
done <<'LIST'
device-link-target-ignored	NAV-02|NAV-03|NAV-06|OFF-12
device-page-loses-a-message	OPEN-01|SCROLL-01
device-newest-two-swapped	MSG-01|MSG-03|MSG-16
LIST
echo "# reruns of built bundles, flag on" >> $d/breaks/results.tsv
$d/rerun-break.sh device-not-used "OFF-12" >> $log 2>&1
$d/rerun-break.sh changes-reach-neither-screen-nor-device "CMP-03|CMP-13|MSG-18" >> $log 2>&1
$d/rerun-break.sh composer-not-focused-on-arrival "KEY-07" >> $log 2>&1
$d/rerun-break.sh found-list-misses-new-channels "UNR-08" >> $log 2>&1
$d/rerun-break.sh unread-mark-never-shows "UNR-10" >> $log 2>&1
echo "# older breaks built flag off" >> $d/breaks/results.tsv
while IFS=$'\t' read -r name tests; do
  FLAG=off $d/break.sh $b/$name.patch "$tests" >> $log 2>&1 < /dev/null; rm -rf $d/bundles/break-$name/*.map
done <<'LIST'
composer-not-focused-on-arrival	KEY-07
found-list-misses-new-channels	UNR-08
link-target-ignored	NAV-02|NAV-03|NAV-06
live-events-ignored	CMP-03|CMP-13|MSG-18
new-message-goes-above-the-last	MSG-01|MSG-03|MSG-16
page-loses-a-message	OPEN-01|SCROLL-01
unread-mark-never-shows	UNR-10
LIST
echo "end $(date +%T) load $(cut -d' ' -f1-3 /proc/loadavg)" >> $log
echo BREAKS7DONE >> $log
