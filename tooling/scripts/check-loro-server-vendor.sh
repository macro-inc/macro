#!/usr/bin/env bash
# Fails unless vendor/loro-server is the crates.io loro and loro-internal 1.16.2
# source. The deployed sync worker builds from it; it is vendored only so the
# workspace lockfile can hold the editor's loro 1.17.1 beside it. Allowed
# differences: the top manifest's path to the adjacent internal crate, local
# Markdown guides and licenses, and the omitted benchmark trace.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

fetch() {
  local name=$1 sha=$2
  curl --fail --silent --show-error --location --retry 3 --max-time 120 \
    "https://static.crates.io/crates/$name/1.16.2/download" -o "$work/$name.crate"
  echo "$sha  $work/$name.crate" | sha256sum --check --quiet
  mkdir -p "$work/$name"
  tar -xzf "$work/$name.crate" -C "$work/$name" --strip-components=1
}

fetch loro 8e86dea63b66576db244cbc3a40bdb17517263c93f318e2fbe08aca3be1192cb
fetch loro-internal 8d5806b65ee68c3ae7891959dd968898860dab74fbf6498b312de9b548dce5ec

status=0
compare() {
  local name=$1
  if ! diff -r \
    -x '.cargo_vcs_info.json' -x 'Cargo.toml.orig' -x '*.md' -x 'LICENSE' \
    -x 'automerge-paper.json.gz' -x 'Cargo.toml' \
    "$work/$name" "$root/vendor/loro-server/$name"; then
    status=1
  fi
}
compare loro
compare loro-internal

# loro-internal's manifest is unchanged; loro's adds only the internal path.
diff "$work/loro-internal/Cargo.toml" "$root/vendor/loro-server/loro-internal/Cargo.toml" || status=1
expected=$(sed '/^\[dependencies\.loro-internal\]$/{n;s#$#\npath = "../loro-internal"#}' "$work/loro/Cargo.toml")
diff <(printf '%s\n' "$expected") "$root/vendor/loro-server/loro/Cargo.toml" || status=1

if [ "$status" -ne 0 ]; then
  echo "vendor/loro-server drifted from crates.io loro/loro-internal 1.16.2" >&2
  exit 1
fi
echo "vendor/loro-server matches crates.io loro and loro-internal 1.16.2"
