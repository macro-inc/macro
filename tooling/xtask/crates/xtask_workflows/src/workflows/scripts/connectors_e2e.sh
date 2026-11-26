#!/usr/bin/env bash
# Runs the connectors end-to-end suite against dev and writes the report the
# alert job reads: `coverage.json` in "$CONNECTORS_E2E_RESULTS", naming the
# scenarios that failed (the shape the email suite's coverage report has).
# Without the accounts' API keys every scenario skips and passes.
set -uo pipefail

mkdir -p "$CONNECTORS_E2E_RESULTS"
output="$(mktemp)"
trap 'rm -f "$output"' EXIT

cargo nextest run -P connectors-e2e -p connectors_e2e --no-fail-fast \
  --hide-progress-bar 2>&1 | tee "$output"
status="${PIPESTATUS[0]}"

# A scenario's last result line is its result: `FAIL [ 1.2s] (3/7) <binary> <test>`;
# with retries, one that failed and then passed ends as `FLAKY`, which passes.
failed="$(sed 's/\x1b\[[0-9;]*m//g' "$output" |
  awk '$1 == "FAIL" || $1 == "PASS" || $1 == "FLAKY" { result[$NF] = $1 }
       END { for (test in result) if (result[test] == "FAIL") print test }' |
  sort)"

# A run that built nothing names no scenario: leave no report, so the alert
# says the failed step's log has what went wrong.
if [ "$status" -eq 0 ] || [ -n "$failed" ]; then
  jq -n --arg failed "$failed" \
    '{suite: {failed: ($failed | split("\n") | map(select(. != "")))}, broken: [], gaps: []}' \
    > "$CONNECTORS_E2E_RESULTS/coverage.json"
fi
exit "$status"
