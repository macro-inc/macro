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
# spends ~20 s in guppy on this runner, and compiling it took ~25 s more. The
# key covers every input of the build. It lives in Namespace's remote cache, which
# every runner sees, because a cache volume holds it on only some jobs. Forks have
# no credentials for that cache and always build, in a plain scratch directory.
filter_bin=""

# The token goes through a config descriptor so it stays out of curl's arguments.
filter_cache_request() {
  curl --fail --silent --show-error --max-time 30 --retry 2 \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}

# With no arguments a working filter exits non-zero and prints its usage. A corrupt
# binary in the cache would otherwise fail path-check for every PR on that key.
filter_bin_runs() {
  chmod +x "$filter_bin"
  case "$("$filter_bin" 2>&1 || true)" in
    *usage:*) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_filter_bin() {
  [ -n "$filter_bin" ] && return 0
  local key cache_url=""
  key="$(git rev-parse \
    HEAD:tooling/xtask/crates/xtask_nextest_filter \
    HEAD:tooling/xtask/crates/xtask_graph \
    HEAD:tooling/xtask/crates/xtask_paths \
    HEAD:Cargo.lock \
    HEAD:Cargo.toml \
    HEAD:rust-toolchain.toml | sha256sum | cut -c1-16)"
  filter_bin="$RUNNER_TEMP/xtask_nextest_filter-$key"

  if [ -n "${SCCACHE_WEBDAV_ENDPOINT:-}" ]; then
    cache_url="$SCCACHE_WEBDAV_ENDPOINT/nextest-filter/$key"
    if filter_cache_request --output "$filter_bin" "$cache_url" && filter_bin_runs; then
      echo "Using cached nextest-filter build $key"
      return 0
    fi
  fi

  echo "Building nextest-filter $key"
  CARGO_TARGET_DIR="$FILTER_CACHE_DIR/target" \
    cargo build --release --locked --quiet -p xtask_nextest_filter
  cp "$FILTER_CACHE_DIR/target/release/xtask_nextest_filter" "$filter_bin"

  # Losing the upload costs the next job a rebuild, not a failure.
  if [ -n "$cache_url" ]; then
    filter_cache_request --upload-file "$filter_bin" "$cache_url" \
      || echo "::warning::Could not save the nextest filter to the remote cache"
  fi
}

emit() {
  echo "rust_packages=$1" >> "$GITHUB_OUTPUT"
  echo "skip_tests=$2" >> "$GITHUB_OUTPUT"
  exit 0
}

# The merge queue is what stands between narrowed PR checks and main.
if [ "${GITHUB_EVENT_NAME:-}" = "merge_group" ]; then
  echo "Merge queue; running all tests"
  emit all false
fi

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
