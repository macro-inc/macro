set -euo pipefail

# Writes `rust_packages` for the check/test jobs:
#   all  — compile and run the whole workspace
#   none — no Rust packages to lint/test (Nix-only, top-level JSON, docs, …)
#   <names> — space-separated workspace packages (changed + reverse deps)
#
# Only Cargo/toolchain/config edits force `all`. flake.nix, the Nix shell
# action, and this workflow file used to live on that list and turned every
# dev-shell tweak into a full-suite rebuild.

if [ ! -s /tmp/changed-files ]; then
  echo "Unknown or empty change set; running all tests"
  echo "rust_packages=all" >> "$GITHUB_OUTPUT"
  exit 0
fi

if grep -qE '^(Cargo\.(toml|lock)|rust-toolchain\.toml|Cross\.toml|clippy\.toml|deny\.toml|\.cargo/.*|\.config/.*)$' /tmp/changed-files; then
  echo "Workspace-level Cargo/toolchain change detected; running all tests"
  echo "rust_packages=all" >> "$GITHUB_OUTPUT"
  exit 0
fi

# A diff touching only `.sqlx/` needs no tests at all. The test job compiles
# queries against live Postgres (SQLX_OFFLINE is unset there), so `.sqlx`
# contents cannot change test outcomes, and a query change always comes with
# a source change in the owning crate.
if ! grep -qvE '^\.sqlx/' /tmp/changed-files; then
  echo "Only .sqlx changes detected; running no tests"
  echo "rust_packages=none" >> "$GITHUB_OUTPUT"
  exit 0
fi

packages="$(cargo run --manifest-path tooling/xtask/Cargo.toml -- nextest-filter /tmp/changed-files)"

if [ -z "$packages" ] || [ "$packages" = "none" ]; then
  echo "No package-specific Rust changes detected; running no tests"
  echo "rust_packages=none" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "rust packages: $packages"
echo "rust_packages=$packages" >> "$GITHUB_OUTPUT"
