set -euo pipefail

# Mirrors run_tests.sh package selection so clippy only lints the crates this
# PR can actually affect. `all` keeps the historical workspace invocation,
# including sync_service's special-cased feature set.

packages="${RUST_PACKAGES:-}"

clippy_sync_service() {
  cargo clippy -p sync_service -- \
    -A clippy::unnecessary_map_or \
    -A clippy::collapsible_if
}

if [ -z "$packages" ] || [ "$packages" = "all" ]; then
  cargo clippy --workspace --all-features --exclude sync_service
  clippy_sync_service
  exit 0
fi

if [ "$packages" = "none" ]; then
  echo "No Rust packages to lint"
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
  cargo clippy --all-features "${pkg_args[@]}"
fi

if [ "$sync" = true ]; then
  clippy_sync_service
fi
