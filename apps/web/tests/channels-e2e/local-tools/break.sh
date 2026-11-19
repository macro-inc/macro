#!/usr/bin/env bash
# Prove tests can fail: apply a product break, build the bundle into the break stack
# (che2e-main-on, port 24909), undo the break in the source, run the named tests.
#   break.sh <patch file> <playwright -g pattern>
# Prints one line per test: FAILED (the proof) or PASSED (the test did not notice).
set -uo pipefail
patch=$(realpath "$1"); pattern=$2
name=$(basename "$patch" .patch)
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
\cd "$root"
git apply --check "$patch" || { echo "patch does not apply: $name"; exit 2; }
git apply "$patch"
~/.cache/channels-e2e/build-bundle.sh che2e-main-on; built=$?
git apply -R "$patch"
[ "$built" -eq 0 ] || { echo "build failed: $name"; tail -20 ~/.cache/channels-e2e/logs/bundle-build.log; exit 2; }
RUN_TAG="break-$name" ~/.cache/channels-e2e/run.sh 24909 -g "$pattern" > ~/.cache/channels-e2e/logs/break-$name.log 2>&1
jq -r --arg name "$name" '[.. | objects | select(.specs?) | .specs[]] | .[] | "\($name)\t\(.title | split(" ")[0])\t\(if (.tests | all(.status == "expected")) then "PASSED" else "FAILED" end)\t\(.tests[0].results[0].errors[0].message // "" | gsub("\u001b\\[[0-9;]*m"; "") | split("\n") | map(select(. != "")) | .[0:2] | join(" | ") | .[0:160])"' \
  ~/.cache/channels-e2e/runs/24909-break-$name/playwright-report.json | tee -a ~/.cache/channels-e2e/breaks/results.tsv
