#!/usr/bin/env bash
set -euo pipefail

update_hash_file() {
  local path=$1
  local system=$2
  local hash=$3
  local entries
  local sorted
  local tmp
  local updated=false
  local total=0
  local index=0
  local line key value comma

  entries=$(mktemp)
  sorted=$(mktemp)
  tmp=$(mktemp)

  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*\"([^\"]+)\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
      key=${BASH_REMATCH[1]}
      value=${BASH_REMATCH[2]}
      if [ "$key" = "$system" ]; then
        value=$hash
        updated=true
      fi
      printf '%s\t%s\n' "$key" "$value" >> "$entries"
    fi
  done < "$path"

  if [ "$updated" = false ]; then
    printf '%s\t%s\n' "$system" "$hash" >> "$entries"
  fi

  LC_ALL=C sort "$entries" > "$sorted"
  total=$(wc -l < "$sorted" | tr -d ' ')

  {
    echo "{"
    echo "  \"nodeModules\": {"
    while IFS=$'\t' read -r key value; do
      index=$((index + 1))
      comma=","
      if [ "$index" -eq "$total" ]; then
        comma=""
      fi
      printf '    "%s": "%s"%s\n' "$key" "$value" "$comma"
    done < "$sorted"
    echo "  }"
    echo "}"
  } > "$tmp"

  mv "$tmp" "$path"
  rm -f "$entries" "$sorted"
}

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

system=$(nix eval --raw --impure --expr 'builtins.currentSystem')
log=$(mktemp)
trap 'rm -f "$log"' EXIT

set +e
nix build .#js-node-modules --no-link 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -eq 0 ]; then
  echo "nix-support/node_modules-hashes.json is already up to date for $system"
  exit 0
fi

hash=$(grep -Eo 'got:[[:space:]]+sha256-[A-Za-z0-9+/=]+' "$log" | tail -n1 | awk '{print $2}')
if [ -z "$hash" ]; then
  echo "failed to extract expected node_modules hash from nix output" >&2
  exit "$status"
fi

update_hash_file "nix-support/node_modules-hashes.json" "$system" "$hash"

echo "updated nix-support/node_modules-hashes.json for $system to $hash"
nix build .#js-node-modules --no-link
