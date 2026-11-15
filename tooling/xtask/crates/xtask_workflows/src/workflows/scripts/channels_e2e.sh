set -euo pipefail

# Builds every service and the web app, starts the stack and returns once it
# answers. The app is built with the job's VITE_ENABLE_GRAPHQL_SOUP.
started=$(date +%s)
just stack up --no-doppler --instance "$CHANNELS_E2E_INSTANCE" --traces off --no-computers
echo "Local stack up: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"

just seed-scenario --instance "$CHANNELS_E2E_INSTANCE" apply --file seed/scenarios/channels-e2e.json

failed=0
started=$(date +%s)
(cd apps/web && just test-channels-e2e "$CHANNELS_E2E_INSTANCE") || failed=1
echo "Channels suite: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
exit "$failed"
