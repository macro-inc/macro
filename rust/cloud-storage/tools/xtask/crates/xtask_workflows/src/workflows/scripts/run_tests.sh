cd rust/cloud-storage

# --no-tests=pass: a package filter (e.g. an xtask/tooling-only PR -> rdeps(=xtask))
# can legitimately select zero tests; treat that as success, not nextest's default error.
args=(--all-features --lib --bins --tests --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")
if [ -n "$NEXTEST_FILTER" ]; then
  args+=(-E "$NEXTEST_FILTER")
fi
cargo nextest run "${args[@]}"
