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
  --no-fail-fast # TEMP: collect every red regression before the behaviour fix
)

# The Deno tests (code execution, authenticated SDK runs, routine code checks and
# the shipped code-mode programs)
# are ignored by default because they need the pinned runtime. They
# run from this same script so cargo sees identical flags and selection and reuses
# what the first run compiled. Only tests in packages this PR selected can match.
if [ "${NEXTEST_RUN_DENO_TESTS:-}" = "true" ]; then
  common+=(
    --run-ignored only --test-threads 2
    -E 'package(code_execution) or (package(agent_code_mode) and test(every_documented_example_type_checks)) or (package(agent_harness_service) and (test(authenticated_mcp_runs_javascript_and_persists_source_and_result) or test(routine_code::) or test(suggestions_brief_programs_type_check) or test(channel_mention_egress::)))'
  )
# The content search tests need an OpenSearch with the search indices, which the
# job starts only when their package is selected, so their target is left out of
# a plain build (`test = false`) and named here. Same script for the same reason
# as the Deno tests.
elif [ "${NEXTEST_RUN_OPENSEARCH_TESTS:-}" = "true" ]; then
  common+=(
    --test content_search
    -E 'package(opensearch_client) & binary(content_search)'
  )
else
  common+=(--test-threads "$NEXTEST_TEST_THREADS")
fi

# A full run builds every test target with `test = true`. `--tests` drops a
# `test = false` target even when `--test` names it, so the content search run
# names only its own.
workspace_targets=(--tests)
if [ "${NEXTEST_RUN_OPENSEARCH_TESTS:-}" = "true" ]; then
  workspace_targets=()
fi

if [ "$RUST_PACKAGES" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service "${workspace_targets[@]}" "${common[@]}"
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
