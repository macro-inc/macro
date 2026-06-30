#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/update-bun-nix.sh [--check]

Regenerate js/bun.nix from js/bun.lock using the bun2nix version pinned in
flake.lock. With --check, fail if the checked-in js/bun.nix is stale.
EOF
}

check=false
case "${1-}" in
  "") ;;
  --check) check=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root/js"

# Bun records GitHub dependencies in bun.lock using the resolved tag object SHA
# plus an integrity hash. bun2nix expects a lock tuple that still contains the
# github: specifier from package.json. Normalize only the temporary lockfile used
# for bun2nix so the committed bun.lock can stay Bun-owned.
normalized_lock=$(mktemp)
python - "$normalized_lock" <<'PY'
import json
import re
import sys
from pathlib import Path

out = Path(sys.argv[1])
root = Path.cwd()
lock = (root / "bun.lock").read_text()

replacements = {
    "@inkibra/tauri-plugins": json.loads((root / "app/package.json").read_text())["dependencies"]["@inkibra/tauri-plugins"],
    "pdfjs-dist": json.loads((root / "app/packages/block-pdf/package.json").read_text())["dependencies"]["pdfjs-dist"],
}

def github_spec(spec: str) -> str:
    if spec.startswith("github:"):
        return spec
    match = re.fullmatch(r"git\+https://github\.com/([^/]+)/(.+?)\.git#(.+)", spec)
    if not match:
        raise SystemExit(f"unsupported GitHub dependency spec for bun2nix normalization: {spec}")
    owner, repo, rev = match.groups()
    return f"github:{owner}/{repo}#{rev}"

for package_name, spec in replacements.items():
    spec = github_spec(spec)
    owner_repo, rev = spec.removeprefix("github:").split("#", 1)
    owner, repo = owner_repo.split("/", 1)
    cache_key = f"{owner}-{repo}-{rev}"
    identifier = f"{package_name}@{spec}"
    pattern = re.compile(
        rf'^(\s*"{re.escape(package_name)}": \[")[^"]+(", \{{.*\}}, ")[^"]+"(?:, "sha512-[^"]+")?(\],)$',
        re.MULTILINE,
    )
    lock, count = pattern.subn(rf'\g<1>{identifier}\g<2>{cache_key}"\g<3>', lock, count=1)
    if count != 1:
        raise SystemExit(f"failed to normalize bun.lock entry for {package_name}")

out.write_text(lock)
PY

if [ "$check" = true ]; then
  generated=$(mktemp)
  trap 'rm -f "$generated" "$normalized_lock"' EXIT
  RUST_LOG="${RUST_LOG:-error}" nix run "$repo_root#bun2nix" -- -l "$normalized_lock" -o "$generated"
  if ! cmp -s bun.nix "$generated"; then
    echo "js/bun.nix is stale. Run: just update-bun-nix" >&2
    diff -u bun.nix "$generated" || true
    exit 1
  fi
  echo "js/bun.nix is up to date"
else
  trap 'rm -f "$normalized_lock"' EXIT
  RUST_LOG="${RUST_LOG:-error}" nix run "$repo_root#bun2nix" -- -l "$normalized_lock" -o bun.nix
fi
