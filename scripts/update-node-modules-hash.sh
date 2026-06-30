#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

current_system=$(nix eval --raw --impure --expr 'builtins.currentSystem')
if [ "$#" -eq 0 ]; then
  systems=("$current_system")
  if [ "$current_system" != "aarch64-darwin" ]; then
    systems+=("aarch64-darwin")
  fi
else
  systems=("$@")
fi

update_hash() {
  local system=$1
  local package="js-node-modules"
  if [ "$system" != "$current_system" ]; then
    package="js-node-modules-$system"
  fi

  local log
  log=$(mktemp)

  set +e
  nix build ".#$package" --no-link 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  set -e

  if [ "$status" -eq 0 ]; then
    echo "nix-support/node_modules-hashes.json is already up to date for $system"
    rm -f "$log"
    return 0
  fi

  local hash
  hash=$(grep -Eo 'got:[[:space:]]+sha256-[A-Za-z0-9+/=]+' "$log" | tail -n1 | awk '{print $2}')
  rm -f "$log"
  if [ -z "$hash" ]; then
    echo "failed to extract expected node_modules hash from nix output for $system" >&2
    return "$status"
  fi

  python3 - "$system" "$hash" <<'PY'
import json
import sys
from pathlib import Path

system, hash_value = sys.argv[1:]
path = Path("nix-support/node_modules-hashes.json")
data = json.loads(path.read_text())
data.setdefault("nodeModules", {})[system] = hash_value
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

  echo "updated nix-support/node_modules-hashes.json for $system to $hash"
  nix build ".#$package" --no-link
}

for system in "${systems[@]}"; do
  update_hash "$system"
done
