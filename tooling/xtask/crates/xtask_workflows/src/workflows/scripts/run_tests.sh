set -euo pipefail

# --no-tests=pass: a package filter can legitimately select a crate with no
# tests; treat that as success, not nextest's default error.
# sync-service is not part of this suite, and its storage backends are mutually
# exclusive under --all-features.
#
# Package selection uses `cargo nextest run -p`, not `--workspace -E rdeps(...)`.
# The filterset only decides which tests *run* after a workspace build; `-p`
# is what keeps an unrelated crate's test binary from being compiled.
#
# `--tests` with `--workspace` builds the test binary of every target with
# `test = true`. `--bins` would also build the bins that opt out, and the normal
# library beneath them.
# Unconstrained `-p` still runs that package's tests.

: "${RUST_PACKAGES:?RUST_PACKAGES is required}"
# Nothing in this build carries debug info: the job sets CARGO_PROFILE_*_DEBUG=0 for
# workspace crates, and this flag covers dependencies. Panic messages keep their
# file and line; backtrace frames keep function names only.
common=(
  --config 'profile.dev.package."*".debug=false'
  --all-features --no-tests=pass
)

# The Deno tests (code execution, authenticated SDK runs and routine code checks)
# are ignored by default because they need the pinned runtime. They
# run from this same script so cargo sees identical flags and selection and reuses
# what the first run compiled. Only tests in packages this PR selected can match.
if [ "${NEXTEST_RUN_DENO_TESTS:-}" = "true" ]; then
  common+=(
    --run-ignored only --test-threads 2
    -E 'package(code_execution) or (package(agent_harness_service) and (test(authenticated_mcp_runs_javascript_and_persists_source_and_result) or test(routine_code::)))'
  )
else
  common+=(--test-threads "$NEXTEST_TEST_THREADS")
fi

if [ "$RUST_PACKAGES" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service --tests "${common[@]}"
  exit 0
fi

pkg_args=()
for package in $RUST_PACKAGES; do
  [ "$package" = "sync_service" ] || pkg_args+=(-p "$package")
done

if [ "${#pkg_args[@]}" -eq 0 ]; then
  echo "No packages in the test suite were affected"
  exit 0
fi

cargo nextest run "${common[@]}" "${pkg_args[@]}"
