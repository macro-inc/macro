set -euo pipefail

xtask=(cargo run --manifest-path tooling/xtask/Cargo.toml -- email-coverage)

# An entry point the code has and the list does not is a failure: the list
# is what the report counts against.
"${xtask[@]}" list --check

# Report only: gaps are listed, not failed. `--enforce` on the next line
# makes a function or an entry point that is neither covered nor waived
# fail this job.
status=0
"${xtask[@]}" report --results "$EMAIL_E2E_RESULTS" --out "$EMAIL_E2E_COVERAGE" || status=$?
if [ -f "$EMAIL_E2E_COVERAGE/coverage.md" ]; then
  cat "$EMAIL_E2E_COVERAGE/coverage.md" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"
