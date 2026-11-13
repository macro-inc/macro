set -euo pipefail

# The bundle and the services build side by side: neither waits for the other.
(cd apps/web && just build-email-e2e) > "$RUNNER_TEMP/email-e2e-bundle.log" 2>&1 &
bundle=$!
# A service that does not compile ends the step: say what the bundle build
# was doing and stop it.
trap 'kill "$bundle" 2>/dev/null || true; tail -n 40 "$RUNNER_TEMP/email-e2e-bundle.log" || true' ERR

# The same builds as the Rust suite, so both share sccache entries.
flags=(--locked --config 'profile.dev.package."*".debug=false')
cargo test --no-run "${flags[@]}" -p email_service --test service_binary_builds
cargo build "${flags[@]}" -p email_scheduled_handler
cargo test --no-run "${flags[@]}" -p document_storage_service --test service_binary_builds
# The server that starts a stack for each browser test.
cargo build "${flags[@]}" -p email_e2e --bin email_e2e_stacks

trap - ERR
if ! wait "$bundle"; then
  cat "$RUNNER_TEMP/email-e2e-bundle.log"
  echo "the web bundle did not build" >&2
  exit 1
fi
tail -n 5 "$RUNNER_TEMP/email-e2e-bundle.log"

started=$(date +%s)
(cd apps/web && just test-email-e2e-browser)
echo "Email browser suite: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
