#!/usr/bin/env bash
set -euo pipefail

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
nix build .#js-node-modules --no-link
