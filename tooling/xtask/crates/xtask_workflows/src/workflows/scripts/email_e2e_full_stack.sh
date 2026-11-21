set -euo pipefail

bundle_log="$RUNNER_TEMP/email-e2e-bundle.log"

# The bundle builds beside the stack's services, without the job's RUSTFLAGS:
# they link the services with mold, and a wasm package the wasm cache misses
# links with rust-lld, which refuses that flag.
(cd apps/web && unset RUSTFLAGS && just build-email-e2e > "$bundle_log" 2>&1) &
web=$!
trap 'kill "$web" 2>/dev/null || true; tail -n 40 "$bundle_log" || true' ERR

# Builds every service, starts the stack and returns once it answers.
started=$(date +%s)
just run_local --no-doppler --instance "$EMAIL_E2E_INSTANCE" --no-frontend --traces off --no-computers
echo "Local stack up: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
trap - ERR

if ! wait "$web"; then
  cat "$bundle_log"
  echo "the web bundle did not build" >&2
  exit 1
fi
tail -n 5 "$bundle_log"
echo "Bundle built: $(( $(date +%s) - started )) s after the start" | tee -a "$GITHUB_STEP_SUMMARY"

failed=0
started=$(date +%s)
(cd apps/web && just test-email-e2e-full-stack "$EMAIL_E2E_INSTANCE") || failed=1
echo "Full-stack tier: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
exit "$failed"
