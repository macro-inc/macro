#!/usr/bin/env bash
# rerun-break.sh <name> <-g pattern>: stage an already built break bundle, run, restage good, record.
set -uo pipefail
d=$HOME/.cache/channels-e2e-b; name=$1; pattern=$2
$d/stage.sh "break-$name"
RUN_TAG="break-$name" CHANNELS_E2E_WORKERS=${W:-3} $d/run.sh -g "$pattern" > $d/logs/break-$name.log 2>&1
$d/stage.sh good
jq -r --arg name "$name" '[.. | objects | select(.specs?) | .specs[]] | .[] | "\($name)\t\(.title | split(" ")[0])\t\(if (.tests | all(.status == "expected")) then (if ([.tests[].results[].annotations[]? | select(.type=="intermittent-defect")] | length) > 0 then "DEFECT-CHECK-FAILED" else "PASSED" end) else "FAILED" end)\t\(.tests[0].results[0].errors[0].message // ([.tests[].results[].annotations[]? | select(.type=="intermittent-defect") | .description][0]) // "" | gsub("\u001b\\[[0-9;]*m"; "") | split("\n") | map(select(. != "")) | .[0:2] | join(" | ") | .[0:160])"' \
  $d/runs/break-$name/playwright-report.json | tee -a $d/breaks/results.tsv
