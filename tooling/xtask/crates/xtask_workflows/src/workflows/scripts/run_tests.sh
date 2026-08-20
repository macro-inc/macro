set -euo pipefail

# --no-tests=pass: a package filter can legitimately select a crate with no
# tests; treat that as success, not nextest's default error.
# sync-service was not part of this suite before it joined the root workspace,
# and its storage backends are mutually exclusive under --all-features.
#
# Package selection uses `cargo nextest run -p`, not `--workspace -E rdeps(...)`.
# The filterset only decides which tests *run* after a workspace build; `-p`
# is what keeps an unrelated crate's test binary from being compiled.

packages="${RUST_PACKAGES:-}"
base=(--all-features --lib --bins --tests --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")

if [ -z "$packages" ] || [ "$packages" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service "${base[@]}"
  exit 0
fi

if [ "$packages" = "none" ]; then
  echo "No Rust packages to test"
  exit 0
fi

sync=false
pkg_args=()
for p in $packages; do
  if [ "$p" = "sync_service" ]; then
    sync=true
  else
    pkg_args+=(-p "$p")
  fi
done

if [ "${#pkg_args[@]}" -gt 0 ]; then
  cargo nextest run "${base[@]}" "${pkg_args[@]}"
fi

if [ "$sync" = true ]; then
  cargo nextest run --lib --bins --tests --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS" -p sync_service
fi
