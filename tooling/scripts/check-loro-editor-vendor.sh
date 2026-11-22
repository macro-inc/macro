#!/usr/bin/env bash
# Fails unless vendor/loro-editor/loro-internal with its `native-editor` feature
# off compiles from exactly the crates.io loro-internal 1.17.1 source. With the
# feature off the editor copy is upstream; servers resolve it that way
# (check-loro-native-editor-features.sh).
#
# Rust sources: xtask_loro_vendor strips what the disabled feature compiles out
# and compares tokens, so comments and formatting may differ. Other files must
# be identical, apart from local Markdown guides and the license, the omitted
# benchmark trace (vendor/loro-editor/README.md), and Cargo.toml, which the
# xtask compares with its declared local keys removed.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
vendor=$root/vendor/loro-editor/loro-internal
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

version=1.17.1
sha=7e533c1688430aa4fcdd933f00861e331c169a4158ee6d27d054e0558892d447
curl --fail --silent --show-error --location --retry 3 --max-time 120 \
  "https://static.crates.io/crates/loro-internal/$version/download" -o "$work/crate"
echo "$sha  $work/crate" | sha256sum --check --quiet
mkdir "$work/upstream"
tar -xzf "$work/crate" -C "$work/upstream" --strip-components=1

status=0
# Rust files are compared by tokens below; files only in the vendor copy are
# inert unless a surviving `mod` reaches them, which that comparison reports.
diff -r -x '*.rs' -x '.cargo_vcs_info.json' -x 'Cargo.toml.orig' -x 'Cargo.lock' \
  -x 'deno.lock' -x '*.md' -x 'LICENSE' -x 'automerge-paper.json.gz' -x 'Cargo.toml' \
  -x '.gitignore' "$work/upstream" "$vendor" || status=1

cargo run --locked --quiet -p xtask_loro_vendor -- "$work/upstream" "$vendor" \
  --feature native-editor || status=1

if [ "$status" -ne 0 ]; then
  echo "vendor/loro-editor/loro-internal with native-editor off drifted from crates.io loro-internal $version" >&2
  exit 1
fi
echo "vendor/loro-editor/loro-internal with native-editor off matches crates.io loro-internal $version"
