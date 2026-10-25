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

# Most of soup's dependents build it without `outbound` (no features, or
# `ports` alone), where helpers only the service or the Postgres repository
# call are dead code that --all-features hides.
clippy_soup_without_outbound() {
  cargo clippy -p soup --no-default-features
  cargo clippy -p soup --no-default-features --features ports
}

if [ -z "$packages" ] || [ "$packages" = "all" ]; then
  cargo clippy --workspace --all-features --exclude sync_service
  clippy_sync_service
  clippy_soup_without_outbound
  exit 0
fi

if [ "$packages" = "none" ]; then
  echo "No Rust packages to lint"
  exit 0
fi

sync=false
soup=false
pkg_args=()
for p in $packages; do
  if [ "$p" = "sync_service" ]; then
    sync=true
  else
    pkg_args+=(-p "$p")
  fi
  if [ "$p" = "soup" ]; then
    soup=true
  fi
done

if [ "${#pkg_args[@]}" -gt 0 ]; then
  cargo clippy --all-features "${pkg_args[@]}"
fi

if [ "$sync" = true ]; then
  clippy_sync_service
fi

if [ "$soup" = true ]; then
  clippy_soup_without_outbound
fi
