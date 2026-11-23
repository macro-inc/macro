set -euo pipefail

bundle_log="$RUNNER_TEMP/email-e2e-bundle.log"
fixtures_log="$RUNNER_TEMP/email-e2e-fixtures.log"
bundle_built="$RUNNER_TEMP/email-e2e-bundle.built"

# The bundle builds beside the services, and the fixture suites, which need
# the bundle's wasm packages but no service, start as soon as it is built.
# The suite is split over machines (EMAIL_E2E_SHARD, "2/3"); the fixture
# suites run on the first only. The job's RUSTFLAGS link the services with
# mold; a wasm package links with rust-lld, which refuses that flag, so the
# bundle builds without them (a package the wasm cache misses is built here).
(
  cd apps/web
  unset RUSTFLAGS
  just build-email-e2e > "$bundle_log" 2>&1 || exit 90
  touch "$bundle_built"
  if [ "${EMAIL_E2E_SHARD%%/*}" = 1 ]; then
    just test-email-fixtures-browser > "$fixtures_log" 2>&1
  else
    echo "the fixture suites run on the first shard" > "$fixtures_log"
  fi
) &
web=$!
# A service that does not compile ends the step: say what the web side was
# doing and stop it.
trap 'pkill -P "$web" 2>/dev/null || true; kill "$web" 2>/dev/null || true; tail -n 40 "$bundle_log" || true' ERR

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
(cd apps/web && just test-email-e2e-browser --shard "$EMAIL_E2E_SHARD") || failed=1
echo "Email browser suite, shard $EMAIL_E2E_SHARD: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"

echo "::group::fixture suites"
if wait "$web"; then
  # Each suite's counts, and the tests listed under its flaky count: those
  # that passed only on a retry. A failed suite prints its whole log below.
  awk '/^Running|^ +[0-9]+ (passed|skipped|did not run)/ { names = 0; print; next }
    /^ +[0-9]+ flaky$/ { names = 1; print; next }
    names && /^    / { print; next }
    { names = 0 }' "$fixtures_log"
else
  cat "$fixtures_log"
  echo "a fixture suite failed" >&2
  failed=1
fi
echo "::endgroup::"
echo "Fixture suites done: $(( $(date +%s) - started )) s after the suite started" | tee -a "$GITHUB_STEP_SUMMARY"
exit "$failed"
