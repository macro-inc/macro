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

extract_json_string_field() {
  local file=$1
  local field=$2
  grep -F "\"$field\"" "$file" | head -n1 | sed -E 's/^[[:space:]]*"[^"]+"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

github_spec() {
  local spec=$1
  if [[ "$spec" == github:* ]]; then
    printf '%s\n' "$spec"
    return
  fi

  if [[ "$spec" =~ ^git\+https://github\.com/([^/]+)/([^/]+)\.git#(.+)$ ]]; then
    printf 'github:%s/%s#%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return
  fi

  echo "unsupported GitHub dependency spec for bun2nix normalization: $spec" >&2
  exit 1
}

sed_replacement_escape() {
  printf '%s\n' "$1" | sed -e 's/[|&\\]/\\&/g'
}

normalize_github_dep() {
  local normalized_lock=$1
  local package_name=$2
  local package_json=$3

  local spec
  spec=$(extract_json_string_field "$package_json" "$package_name")
  if [ -z "$spec" ]; then
    echo "failed to find $package_name in $package_json" >&2
    exit 1
  fi
  spec=$(github_spec "$spec")

  local owner_repo=${spec#github:}
  owner_repo=${owner_repo%%#*}
  local rev=${spec##*#}
  local owner=${owner_repo%%/*}
  local repo=${owner_repo#*/}
  local cache_key="${owner}-${repo}-${rev}"
  local identifier="${package_name}@${spec}"

  local identifier_replacement cache_key_replacement
  identifier_replacement=$(sed_replacement_escape "$identifier")
  cache_key_replacement=$(sed_replacement_escape "$cache_key")

  # Bun records GitHub dependencies in bun.lock using the resolved tag object
  # SHA plus an integrity hash. bun2nix expects a lock tuple that still contains
  # the github: specifier from package.json. Normalize only the temporary
  # lockfile used for bun2nix so the committed bun.lock can stay Bun-owned.
  sed -E -i.bak \
    "s|^([[:space:]]*\"${package_name}\": \[\")[^\"]+(\", \\{.*\\}, \")[^\"]+\"(, \"sha512-[^\"]+\")?(\],)$|\\1${identifier_replacement}\\2${cache_key_replacement}\"\\4|" \
    "$normalized_lock"
  rm -f "$normalized_lock.bak"

  if ! grep -Fq "\"$package_name\": [\"$identifier\"" "$normalized_lock"; then
    echo "failed to normalize bun.lock entry for $package_name" >&2
    exit 1
  fi
}

normalized_lock=$(mktemp)
cp bun.lock "$normalized_lock"
normalize_github_dep "$normalized_lock" "@inkibra/tauri-plugins" "app/package.json"
normalize_github_dep "$normalized_lock" "pdfjs-dist" "app/packages/block-pdf/package.json"

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
