set -euo pipefail

# Builds every service and the web app, starts the stack and returns once it
# answers.
# A service built without optimization exhausts a worker thread's default stack
# on a Soup request (docs/development/running-locally.md), which every page of
# the suite makes.
stack_env=$(mktemp)
echo 'RUST_MIN_STACK=16777216' > "$stack_env"

started=$(date +%s)
just stack up --no-doppler --instance "$CHANNELS_E2E_INSTANCE" --traces off --no-computers \
  --env-file "$stack_env"
echo "Local stack up: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"

just seed-scenario --instance "$CHANNELS_E2E_INSTANCE" apply --file seed/scenarios/channels-e2e.json

failed=0
started=$(date +%s)
(cd apps/web && just test-channels-e2e "$CHANNELS_E2E_INSTANCE") || failed=1
echo "Channels suite: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"

# The ledger against the tests and the run: every test listed, every outcome
# the one the ledger expects, and the intermittent defects that showed.
(cd apps/web && bun tests/channels-e2e/ledger/check.ts \
  --report tests/channels-e2e/.run/playwright-report.json) 2>&1 |
  tee -a "$GITHUB_STEP_SUMMARY" || failed=1
exit "$failed"
