set -euo pipefail

# --no-tests=pass: a package filter can legitimately select a crate with no
# tests; treat that as success, not nextest's default error.
# sync-service was not part of this suite before it joined the root workspace,
# and its storage backends are mutually exclusive under --all-features.
#
# Package selection uses `cargo nextest run -p`, not `--workspace -E rdeps(...)`.
# The filterset only decides which tests *run* after a workspace build; `-p`
# is what keeps an unrelated crate's test binary from being compiled.
#
# `--lib --bins --tests` is safe with `--workspace` (cargo skips packages that
# lack a given target type) but fails with `-p` when any selected package has
# no lib — xtask binaries such as xtask_nextest_filter / xtask_workflows.
# Unconstrained `-p` still runs that package's tests.

packages="${RUST_PACKAGES:-}"
workspace=(--all-features --lib --bins --tests --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")
selected=(--all-features --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")
sync_service=(--no-tests=pass --test-threads "$NEXTEST_TEST_THREADS" -p sync_service)

if [ -z "$packages" ] || [ "$packages" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service "${workspace[@]}"
  cargo nextest run "${sync_service[@]}"
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
  cargo nextest run "${selected[@]}" "${pkg_args[@]}"
fi

if [ "$sync" = true ]; then
  cargo nextest run "${sync_service[@]}"
fi
