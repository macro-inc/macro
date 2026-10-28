set -euo pipefail

# Writes for the check/test jobs:
#   rust_packages — all | none | space-separated packages (changed + reverse deps)
#   skip_tests    — true keeps clippy on rust_packages while the live-Postgres
#                   test job stays skipped (`.sqlx`-only or clippy.toml-only diffs)
#
# Toolchain and cargo/nextest config edits force `all`. Root Cargo.toml and
# Cargo.lock go to the xtask: determinator's old/new graph comparison scopes
# lockfile, member, and workspace-dependency changes, and the xtask returns
# `all` for any other root-manifest edit (profiles, lints, patches, …).
# Cross.toml and deny.toml configure other tools and select nothing here.
# clippy.toml changes lint results but not test outcomes (handled below).
# flake.nix, the Nix shell action, and this workflow file used to live on the
# full-suite list and turned every dev-shell tweak into a full-suite rebuild.

# The filter runs as a release binary cached per source tree: a debug build
# spends ~20 s in guppy on this runner, and compiling it took ~40 s more. The
# key covers every input of the build, so a hit is exactly what `cargo build`
# would produce. FILTER_CACHE_DIR is a Namespace cache volume for same-repo
# PRs and a plain scratch directory for forks.
filter_bin=""
ensure_filter_bin() {
  [ -n "$filter_bin" ] && return 0
  local key bin_dir staging
  key="$(git rev-parse \
    HEAD:tooling/xtask/crates/xtask_nextest_filter \
    HEAD:tooling/xtask/crates/xtask_graph \
    HEAD:tooling/xtask/crates/xtask_paths \
    HEAD:Cargo.lock \
    HEAD:rust-toolchain.toml | sha256sum | cut -c1-16)"
  bin_dir="$FILTER_CACHE_DIR/bin/$key"
  filter_bin="$bin_dir/xtask_nextest_filter"
  if [ -x "$filter_bin" ]; then
    echo "Using cached nextest-filter build $key"
    touch "$bin_dir"
    return 0
  fi

  echo "Building nextest-filter $key"
  CARGO_TARGET_DIR="$FILTER_CACHE_DIR/target" \
    cargo build --release --locked --quiet -p xtask_nextest_filter
  staging="$(mktemp -d "$FILTER_CACHE_DIR/bin/.staging.XXXXXX")"
  cp "$FILTER_CACHE_DIR/target/release/xtask_nextest_filter" "$staging/"
  # Another job may have published the same key meanwhile; either copy works.
  mv -T "$staging" "$bin_dir" 2>/dev/null || rm -rf "$staging"
  # Drop builds no PR has used for a week (every Cargo.lock change adds one).
  find "$FILTER_CACHE_DIR/bin" -mindepth 1 -maxdepth 1 -type d -mtime +7 \
    -exec rm -rf {} + || true
}
mkdir -p "$FILTER_CACHE_DIR/bin"

emit() {
  echo "rust_packages=$1" >> "$GITHUB_OUTPUT"
  echo "skip_tests=$2" >> "$GITHUB_OUTPUT"
  exit 0
}

if [ ! -s /tmp/changed-files ]; then
  echo "Unknown or empty change set; running all tests"
  emit all false
fi

if grep -qE '^(rust-toolchain\.toml|\.cargo/.*|\.config/.*)$' /tmp/changed-files; then
  echo "Toolchain or cargo config change detected; running all tests"
  emit all false
fi

clippy_config_changed=false
if grep -qx 'clippy\.toml' /tmp/changed-files; then
  clippy_config_changed=true
fi

# The test job compiles queries against live Postgres (SQLX_OFFLINE is unset
# there), so `.sqlx` contents cannot change test outcomes. Clippy is the
# offline SQLx check (`SQLX_OFFLINE=true`), so a snapshot-only diff must
# still compile against the cache rather than skip the check job.
if ! grep -qvE '^\.sqlx/' /tmp/changed-files; then
  echo "Only .sqlx changes detected; clippy all, skip live-Postgres tests"
  emit all true
fi

ensure_filter_bin
packages="$("$filter_bin" /tmp/changed-files "$(< /tmp/base-revision)")"

# One package list drives both clippy and tests, so a clippy.toml edit can
# only skip tests when nothing else selected a package.
if [ "$clippy_config_changed" = true ]; then
  if [ -z "$packages" ] || [ "$packages" = "none" ]; then
    echo "Only clippy.toml affects Rust; clippy all, skip live-Postgres tests"
    emit all true
  fi
  echo "clippy.toml changed alongside package changes; running all tests"
  emit all false
fi

if [ -z "$packages" ] || [ "$packages" = "none" ]; then
  echo "No package-specific Rust changes detected; running no tests"
  emit none false
fi

echo "rust packages: $packages"
emit "$packages" false
