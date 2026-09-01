set -euo pipefail

# Root cargo/toolchain/CI changes can affect the whole workspace, so run all tests.
# `.sqlx/` is deliberately not in this list: the test job compiles queries against
# live Postgres (SQLX_OFFLINE is unset there), so `.sqlx` contents cannot change
# test outcomes, and a query change always comes with a source change in the
# owning crate, which the package filter below already maps.
# Cargo.lock is omitted: determinator compares the old and new Cargo graphs.
if grep -qE '^(Cargo\.toml|rust-toolchain\.toml|Cross\.toml|clippy\.toml|deny\.toml|\.cargo/.*|\.config/.*|flake\.nix|flake\.lock|\.github/actions/(setup-rust|setup-nix|setup-nix-dev-shell|setup-sccache)/.*|\.github/workflows/code_check_cloud_storage\.yml)$' /tmp/changed-files; then
  echo "Workspace-level change detected; running all tests"
  echo "nextest_filter=" >> "$GITHUB_OUTPUT"
  exit 0
fi

# A diff touching only `.sqlx/` needs no tests at all — without this it would
# fall through to the empty-filter "run everything" fallback below. `none()`
# selects zero tests, which `--no-tests=pass` treats as success. The `-s` guard
# keeps an empty changed-files list (unknown merge-base) on the full-suite path.
if [ -s /tmp/changed-files ] && ! grep -qvE '^\.sqlx/' /tmp/changed-files; then
  echo "Only .sqlx changes detected; running no tests"
  echo "nextest_filter=none()" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [ ! -s /tmp/changed-files ] || [ ! -s /tmp/base-revision ]; then
  echo "Unknown or empty change set; running all tests"
  echo "nextest_filter=" >> "$GITHUB_OUTPUT"
  exit 0
fi

packages="$(cargo run --manifest-path tooling/xtask/Cargo.toml -- nextest-filter /tmp/changed-files "$(< /tmp/base-revision)")"

# Keep the current nextest filterset contract so this PR can land without the
# `-p` runner rewrite. `all` / empty / `none` still mean "run the full suite"
# here; a follow-up can switch bash to `rust_packages` and treat `none` as skip.
if [ -z "$packages" ] || [ "$packages" = "all" ] || [ "$packages" = "none" ]; then
  echo "No package-specific Rust changes detected; running all tests"
  echo "nextest_filter=" >> "$GITHUB_OUTPUT"
  exit 0
fi

filterset=""
for package in $packages; do
  escaped="${package//\\/\\\\}"
  escaped="${escaped//)/\\)}"
  escaped="${escaped//,/\\,}"
  if [ -n "$filterset" ]; then
    filterset="${filterset}|"
  fi
  filterset="${filterset}rdeps(=${escaped})"
done

echo "nextest filter: $filterset"
echo "nextest_filter=$filterset" >> "$GITHUB_OUTPUT"
