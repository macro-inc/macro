#!/usr/bin/env bash
# Regenerates every Bazel file from Cargo manifests. Run from the repository root.
set -euo pipefail
: "${BAZEL_PROTO_DB_URL:?BAZEL_PROTO_DB_URL names the database test targets compile against}"
meta="$(mktemp)"
grep -q 'tooling/bazel-proto/all_features' Cargo.toml || sed -i '0,/^members = \[/s##members = [\n  "tooling/bazel-proto/all_features",#' Cargo.toml
mkdir -p tooling/bazel-proto/all_features/src
[ -f tooling/bazel-proto/all_features/Cargo.toml ] || printf '[package]\nname = "bazel_all_features"\nversion = "0.0.0"\nedition = "2024"\npublish = false\n' > tooling/bazel-proto/all_features/Cargo.toml
touch tooling/bazel-proto/all_features/src/lib.rs
cargo metadata --format-version 1 --all-features --filter-platform x86_64-unknown-linux-gnu > "$meta"
python3 tooling/bazel-proto/gen.py --all-features-crate "$meta"
cargo metadata --format-version 1 --all-features --filter-platform x86_64-unknown-linux-gnu > "$meta"
python3 tooling/bazel-proto/gen.py "$meta"
# gcc finds a linker named `ld` in -B directories; mold ships one there.
mold_dir="$(dirname "$(dirname "$(readlink -f "$(command -v mold)")")")/libexec/mold"
{
  echo "build --@rules_rust//rust/settings:extra_rustc_flag=-Clink-arg=-B$mold_dir"
  echo "build --@rules_rust//rust/settings:extra_exec_rustc_flag=-Clink-arg=-B$mold_dir"
} > generated.bazelrc
