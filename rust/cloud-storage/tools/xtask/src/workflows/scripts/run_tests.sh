cd rust/cloud-storage

args=(--all-features --lib --bins --tests --test-threads "$NEXTEST_TEST_THREADS")
if [ -n "$NEXTEST_FILTER" ]; then
  args+=(-E "$NEXTEST_FILTER")
fi
cargo nextest run "${args[@]}"
