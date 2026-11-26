set -euo pipefail

xtask=(cargo run --manifest-path tooling/xtask/Cargo.toml -- email-coverage)

# An entry point the code has and the list does not is a failure: the list
# is what the report counts against.
"${xtask[@]}" list --check

# Enforced: a scenario that failed, a function that is not proved and not
# waived, an entry point that is not reached and not waived, a ledger line
# the records do not bear out, and a scenario kept for a known bug that
# passes each fail this job. The report is written and shown either way.
mkdir -p "$EMAIL_E2E_RESULTS"
# One directory per job that runs scenarios for known bugs, named after the
# artifact it uploads: a job that kept no results fails the report. Only the
# daily sweep and a run by hand that asks for it run them.
known_bugs=()
if [ "$EMAIL_E2E_REPORT_KNOWN_BUGS" = true ]; then
  for job in search rest; do
    known_bugs+=(--known-bugs "$EMAIL_E2E_KNOWN_BUGS/email-e2e-known-bugs-$job")
  done
fi
status=0
"${xtask[@]}" report --enforce --results "$EMAIL_E2E_RESULTS" \
  "${known_bugs[@]}" --out "$EMAIL_E2E_COVERAGE" || status=$?
if [ -f "$EMAIL_E2E_COVERAGE/coverage.md" ]; then
  cat "$EMAIL_E2E_COVERAGE/coverage.md" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
