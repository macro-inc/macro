#!/usr/bin/env bash
# break.sh <patch> <-g pattern>: apply a product break, build, undo the break in source, stage, run, restage the good bundle.
set -uo pipefail
d=$HOME/.cache/channels-e2e-b
patch=$(realpath "$1"); pattern=$2; name=$(basename "$patch" .patch)
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
\cd "$root"
git apply --check "$patch" || { echo "patch does not apply: $name"; exit 2; }
git apply "$patch"
$d/build-bundle.sh "break-$name"; built=$?
git apply -R "$patch"
[ "$built" -eq 0 ] || { echo "build failed: $name"; tail -20 $d/logs/bundle-break-$name.log; exit 2; }
$d/stage.sh "break-$name"
RUN_TAG="break-$name" CHANNELS_E2E_WORKERS=${W:-3} $d/run.sh -g "$pattern" > $d/logs/break-$name.log 2>&1
$d/stage.sh good
jq -r --arg name "$name" '[.. | objects | select(.specs?) | .specs[]] | .[] | "\($name)\t\(.title | split(" ")[0])\t\(if (.tests | all(.status == "expected")) then (if ([.tests[].results[].annotations[]? | select(.type=="intermittent-defect")] | length) > 0 then "DEFECT-CHECK-FAILED" else "PASSED" end) else "FAILED" end)\t\(.tests[0].results[0].errors[0].message // ([.tests[].results[].annotations[]? | select(.type=="intermittent-defect") | .description][0]) // "" | gsub("\u001b\\[[0-9;]*m"; "") | split("\n") | map(select(. != "")) | .[0:2] | join(" | ") | .[0:160])"' \
  $d/runs/break-$name/playwright-report.json | tee -a $d/breaks/results.tsv
