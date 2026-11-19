#!/usr/bin/env bash
# tally.sh <tag>...: one line per test and run: id, tag, outcome (held|defect|failed|expected-fail|unexpected-pass|skipped)
for tag in "$@"; do
  jq -r --arg tag "$tag" '[.. | objects | select(has("specs")) | .specs[]] | .[] |
    (.title | split(" ")[0]) as $id | .tests[0] as $t | ($t.results[-1]) as $r |
    (if $t.status == "skipped" then "skipped"
     elif $t.expectedStatus == "failed" then (if $r.status == "failed" or $r.status == "timedOut" then "expected-fail" else "unexpected-pass" end)
     elif $r.status != "passed" then "failed"
     elif ([($t.annotations // [])[], ($r.annotations // [])[]] | map(select(.type == "intermittent-defect")) | length) > 0 then "defect"
     else "held" end) as $o | "\($id)\t\($tag)\t\($o)"' $HOME/.cache/channels-e2e-b/runs/$tag/playwright-report.json
done
