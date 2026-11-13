set -euo pipefail

bundle_log="$RUNNER_TEMP/email-e2e-bundle.log"
fixtures_log="$RUNNER_TEMP/email-e2e-fixtures.log"
bundle_built="$RUNNER_TEMP/email-e2e-bundle.built"

# The bundle builds beside the services, and the fixture suites, which need
# the bundle's wasm packages but no service, start as soon as it is built.
(
  cd apps/web
  just build-email-e2e > "$bundle_log" 2>&1 || exit 90
  touch "$bundle_built"
  just test-email-fixtures-browser > "$fixtures_log" 2>&1
) &
web=$!
# A service that does not compile ends the step: say what the web side was
# doing and stop it.
trap 'kill "$web" 2>/dev/null || true; tail -n 40 "$bundle_log" || true' ERR

# The same builds as the Rust suite, so both share sccache entries.
flags=(--locked --config 'profile.dev.package."*".debug=false')
cargo test --no-run "${flags[@]}" -p email_service --test service_binary_builds
cargo build "${flags[@]}" -p email_scheduled_handler
cargo test --no-run "${flags[@]}" -p document_storage_service --test service_binary_builds
# The server that starts a stack for each browser test.
cargo build "${flags[@]}" -p email_e2e --bin email_e2e_stacks
trap - ERR

until [ -e "$bundle_built" ] || ! kill -0 "$web" 2>/dev/null; do sleep 1; done
if [ ! -e "$bundle_built" ]; then
  cat "$bundle_log"
  echo "the web bundle did not build" >&2
  exit 1
fi
tail -n 5 "$bundle_log"

failed=0
started=$(date +%s)
(cd apps/web && just test-email-e2e-browser) || failed=1
echo "Email browser suite: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"

echo "::group::fixture suites"
if wait "$web"; then
  grep -E '^ +[0-9]+ (passed|flaky|skipped)|^Running' "$fixtures_log" || true
else
  cat "$fixtures_log"
  echo "a fixture suite failed" >&2
  failed=1
fi
echo "::endgroup::"
echo "Fixture suites done: $(( $(date +%s) - started )) s after the suite started" | tee -a "$GITHUB_STEP_SUMMARY"
exit "$failed"
