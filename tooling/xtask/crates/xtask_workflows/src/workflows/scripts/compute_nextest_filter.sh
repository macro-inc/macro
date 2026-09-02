set -euo pipefail

# Writes `rust_packages` for the check/test jobs:
#   all  — compile and run the whole workspace
#   none — no Rust packages to lint/test (Nix-only, top-level JSON, docs, …)
#   <names> — space-separated workspace packages (changed + reverse deps)
#
# `skip_tests=true` keeps clippy on a package set while the live-Postgres
# test job stays skipped (used for `.sqlx`-only diffs).
#
# Root Cargo/toolchain/config edits force `all`. Cargo.lock is handled by
# determinator's old/new graph comparison. flake.nix, the Nix shell action,
# and this workflow file used to live on the full-suite list and turned every
# dev-shell tweak into a full-suite rebuild.

echo "skip_tests=false" >> "$GITHUB_OUTPUT"

if [ ! -s /tmp/changed-files ]; then
  echo "Unknown or empty change set; running all tests"
  echo "rust_packages=all" >> "$GITHUB_OUTPUT"
  exit 0
fi

if grep -qE '^(Cargo\.toml|rust-toolchain\.toml|Cross\.toml|clippy\.toml|deny\.toml|\.cargo/.*|\.config/.*)$' /tmp/changed-files; then
  echo "Workspace-level Cargo/toolchain change detected; running all tests"
  echo "rust_packages=all" >> "$GITHUB_OUTPUT"
  exit 0
fi

# The test job compiles queries against live Postgres (SQLX_OFFLINE is unset
# there), so `.sqlx` contents cannot change test outcomes. Clippy is the
# offline SQLx check (`SQLX_OFFLINE=true`), so a snapshot-only diff must
# still compile against the cache rather than skip the check job.
if ! grep -qvE '^\.sqlx/' /tmp/changed-files; then
  echo "Only .sqlx changes detected; clippy all, skip live-Postgres tests"
  echo "rust_packages=all" >> "$GITHUB_OUTPUT"
  echo "skip_tests=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

packages="$(cargo run --manifest-path tooling/xtask/Cargo.toml -- nextest-filter /tmp/changed-files "$(< /tmp/base-revision)")"

if [ -z "$packages" ] || [ "$packages" = "none" ]; then
  echo "No package-specific Rust changes detected; running no tests"
  echo "rust_packages=none" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "rust packages: $packages"
echo "rust_packages=$packages" >> "$GITHUB_OUTPUT"
