# --no-tests=pass: a package filter (e.g. an xtask/tooling-only PR -> rdeps(=xtask))
# can legitimately select zero tests; treat that as success, not nextest's default error.
# sync-service was not part of this suite before it joined the root workspace,
# and its storage backends are mutually exclusive under --all-features.
args=(--workspace --exclude sync_service --all-features --lib --bins --tests --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")
if [ -n "$NEXTEST_FILTER" ]; then
  args+=(-E "$NEXTEST_FILTER")
fi
cargo nextest run "${args[@]}"
