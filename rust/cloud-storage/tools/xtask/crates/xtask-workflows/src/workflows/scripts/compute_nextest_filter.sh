set -euo pipefail

# Root cargo/toolchain/CI changes can affect the whole workspace, so run all tests.
if grep -qE '^(rust/rust-toolchain\.toml|flake\.nix|flake\.lock|rust/cloud-storage/Cargo\.(toml|lock)|rust/cloud-storage/\.cargo/.*|\.github/actions/(setup-rust|setup-cachix|setup-sccache)/.*|\.github/workflows/code_check_cloud_storage\.yml)$' /tmp/changed-files; then
  echo "Workspace-level change detected; running all tests"
  echo "nextest_filter=" >> "$GITHUB_OUTPUT"
  exit 0
fi

filterset="$(cargo run --manifest-path rust/cloud-storage/tools/xtask/Cargo.toml -- nextest-filter /tmp/changed-files)"

if [ -z "$filterset" ]; then
  echo "No package-specific Rust changes detected; running all tests"
else
  echo "nextest filter: $filterset"
fi
echo "nextest_filter=$filterset" >> "$GITHUB_OUTPUT"
