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
# `--lib --bins --tests` is safe with `--workspace` (cargo skips packages that
# lack a given target type) but fails with `-p` when any selected package has
# no lib — xtask binaries such as xtask_nextest_filter / xtask_workflows.
# Unconstrained `-p` still runs that package's tests.

: "${RUST_PACKAGES:?RUST_PACKAGES is required}"
common=(--all-features --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")

if [ "$RUST_PACKAGES" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service --lib --bins --tests "${common[@]}"
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
