set -euo pipefail

# Builds every service and the web app, starts the stack and returns once it
# answers.
# A service built without optimization exhausts a worker thread's default stack
# on a Soup request (docs/development/running-locally.md), which every page of
# the suite makes.
stack_env=$(mktemp)
echo 'RUST_MIN_STACK=16777216' > "$stack_env"
# No test starts an agent sandbox, and building the sandbox image is the one
# stage of the bring-up nothing here caches: it clones the repository and
# realizes its dev shell over the network, which has taken from one minute to
# longer than the whole job. With local sandboxes off the stack skips it, and
# the harness service starts with no credential for a hosted one, which it
# allows.
echo 'DEV_DANGEROUS_LOCAL_CONTAINERS=false' >> "$stack_env"

started=$(date +%s)
# The bring-up prints a stage's output only once the stage ends, so a stage
# that never ends leaves nothing in the log. Once a minute, name the build and
# compose commands that are running. Read from /proc: the runner's `ps` does
# not load inside the Nix shell.
running() {
  for cmdline in /proc/[0-9]*/cmdline; do
    # A process may have ended since the list was made.
    { tr '\0' ' ' < "$cmdline"; } 2>/dev/null || true
    echo
  done | grep -E '^([^ ]*/)?(docker|cargo|rustc|bun|node) ' | cut -c1-120 | sort -u | head -n 3 | tr '\n' ';'
}
(
  while sleep 60; do
    echo "starting the stack, $(( $(date +%s) - started )) s: $(running || true)"
  done
) &
watch=$!
trap 'kill "$watch" 2>/dev/null || true' EXIT
# One more try when bring-up fails: a build of the stack has failed once on
# main for a reason of the runner (a linker error), with no test run.
stack_up() {
  just stack up --no-doppler --instance "$CHANNELS_E2E_INSTANCE" --traces off --no-computers \
    --env-file "$stack_env"
}
if ! stack_up; then
  echo "Local stack: the first bring-up failed, trying once more" | tee -a "$GITHUB_STEP_SUMMARY"
  stack_up
fi
kill "$watch" 2>/dev/null || true
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
