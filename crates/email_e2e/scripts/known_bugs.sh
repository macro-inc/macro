#!/usr/bin/env bash
# Runs the scenarios kept for known, unfixed bugs: the tests marked
# `#[ignore = "known bug: <class id>"]`. Each asserts the right behaviour, so
# it fails until the bug is fixed. Prints which still fail (expected) and
# which now pass (remove the `#[ignore]` so the scenario starts gating), and
# writes the same table to the job summary in CI. Exits non-zero only when
# the suite could not be built or run at all.
set -uo pipefail

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

cargo nextest run -P email-e2e -p email_e2e --run-ignored only --no-tests=pass \
  --no-fail-fast --status-level all --final-status-level none --hide-progress-bar \
  "$@" 2>&1 | tee "$output"
status="${PIPESTATUS[0]}"
# 100: tests ran and some failed, which is what this run is for.
if [ "$status" -ne 0 ] && [ "$status" -ne 100 ]; then
  exit "$status"
fi

rows="$(sed 's/\x1b\[[0-9;]*m//g' "$output" | awk '
  $1 == "PASS" || $1 == "FAIL" || $1 == "TIMEOUT" || $1 == "SIGABRT" || $1 == "SIGSEGV" {
    name = $NF; binary = $(NF - 1)
    if ($1 == "PASS") print "| `" binary " " name "` | **now passing: remove the `#[ignore]`** |"
    else print "| `" binary " " name "` | still failing (expected) |"
  }' | sort -u)"

{
  echo "### Email end-to-end: scenarios for known bugs"
  echo
  if [ -z "$rows" ]; then
    echo "No scenario is marked as a known bug."
  else
    echo "| Scenario | Result |"
    echo "| --- | --- |"
    echo "$rows"
  fi
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

if grep -q "now passing" <<<"$rows"; then
  echo "::warning title=Email end-to-end::A scenario for a known bug now passes; remove its #[ignore] so it gates."
fi
