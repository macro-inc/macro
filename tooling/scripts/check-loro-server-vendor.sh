#!/usr/bin/env bash
# Fails unless vendor/loro-server is the crates.io source of the Loro crates the
# deployed sync worker builds (loro and loro-internal 1.16.2, loro-common and
# loro-kv-store 1.16.0). It is vendored only so the workspace lockfile can hold
# the editor's newer Loro beside it. Allowed differences: `path` lines that point
# each manifest at its vendored siblings, local Markdown guides and licenses, and
# the omitted benchmark trace. vendor/loro-server/lint-only.patch is applied to
# the downloaded sources first: it may only drop unused imports or add allow
# attributes, so the repository's -D warnings builds pass.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
vendor=$root/vendor/loro-server
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
status=0

# name version sha256 sibling-dependencies...
check() {
  local name=$1
  shift 3
  diff -r -x '.cargo_vcs_info.json' -x 'Cargo.toml.orig' -x '*.md' -x 'LICENSE' \
    -x 'automerge-paper.json.gz' -x 'Cargo.toml' -x 'lint-only.patch' "$work/$name" "$vendor/$name" || status=1
  local expected=$work/$name.expected.toml
  cp "$work/$name/Cargo.toml" "$expected"
  local dependency
  for dependency in "$@"; do
    sed -i "/^\[dependencies\.$dependency\]\$/{n;s#\$#\npath = \"../$dependency\"#}" "$expected"
  done
  diff "$expected" "$vendor/$name/Cargo.toml" || status=1
}

unpack() {
  local name=$1 version=$2 sha=$3
  curl --fail --silent --show-error --location --retry 3 --max-time 120 \
    "https://static.crates.io/crates/$name/$version/download" -o "$work/$name.crate"
  echo "$sha  $work/$name.crate" | sha256sum --check --quiet
  mkdir -p "$work/$name"
  tar -xzf "$work/$name.crate" -C "$work/$name" --strip-components=1
}
unpack loro 1.16.2 8e86dea63b66576db244cbc3a40bdb17517263c93f318e2fbe08aca3be1192cb
unpack loro-internal 1.16.2 8d5806b65ee68c3ae7891959dd968898860dab74fbf6498b312de9b548dce5ec
unpack loro-common 1.16.0 2146b353a56b0a743f8643725cb9f42dfe209665939b59db901ecea732a3ab29
unpack loro-kv-store 1.16.0 841e206d3749fd14f23e64985be230dad2b2199da1d381c44c3dd0d2b9583fcc
(cd "$work" && patch --quiet --forward -p1 < "$vendor/lint-only.patch")
# The patch must stay lint-only: every changed line is an import or an allow.
if grep -E '^[-+][^-+]' "$vendor/lint-only.patch" | grep -vE '^[-+](use |pub use |#\[allow\()'; then
  echo "vendor/loro-server/lint-only.patch changes more than imports and allow attributes" >&2
  exit 1
fi

check loro 1.16.2 8e86dea63b66576db244cbc3a40bdb17517263c93f318e2fbe08aca3be1192cb \
  loro-common loro-internal loro-kv-store
check loro-internal 1.16.2 8d5806b65ee68c3ae7891959dd968898860dab74fbf6498b312de9b548dce5ec \
  loro-common loro-kv-store
check loro-common 1.16.0 2146b353a56b0a743f8643725cb9f42dfe209665939b59db901ecea732a3ab29
check loro-kv-store 1.16.0 841e206d3749fd14f23e64985be230dad2b2199da1d381c44c3dd0d2b9583fcc \
  loro-common

if [ "$status" -ne 0 ]; then
  echo "vendor/loro-server drifted from the crates.io Loro sources" >&2
  exit 1
fi
echo "vendor/loro-server matches crates.io loro, loro-internal, loro-common and loro-kv-store"
