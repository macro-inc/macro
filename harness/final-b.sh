#!/usr/bin/env bash
# final-b.sh: repeats of MSG-13 and CMP-13 under build load, then three whole-suite runs, against chb-fix.
P=~/.cache/channels-perf-b
($P/loadgen.sh 3 &)
$P/rund.sh fm -g "MSG-13|CMP-13" --repeat-each 48 2>&1 | sed -n 1,3p
grep "ANNOT\|✘" $P/e2ed/fm.out | cut -c1-400
for t in fa1 fa2 fa3; do
  $P/runb.sh $t 2>&1 | sed -n 1,3p
  jq -r '[.. | objects | select(has("specs"))? | .specs[]? | {t:.title, s:[.tests[].results[].status]|join(","), a:[.tests[].annotations[]? | select(.type=="intermittent-defect")]} | select((.a|length>0) or (.s!="passed")) | .t[0:6] + " " + .s + (if (.a|length)>0 then " ANNOT" else "" end)] | join(" | ")' $P/e2eb/$t/playwright-report.json
done
