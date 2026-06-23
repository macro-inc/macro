#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <changed-files> [repo-root]" >&2
  exit 2
fi

changed_files=$1
if [[ ! -f "$changed_files" ]]; then
  echo "Changed files list not found: $changed_files" >&2
  exit 2
fi

if [[ $# -eq 2 ]]; then
  repo_root=$2
elif repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  repo_root=$PWD
fi
repo_root=${repo_root%/}

if [[ ! -d "$repo_root" ]]; then
  echo "Repository root not found: $repo_root" >&2
  exit 2
fi

declare -A crate_paths=()
while IFS= read -r changed_file || [[ -n "$changed_file" ]]; do
  changed_file=${changed_file%$'\r'}
  changed_file=${changed_file#./}

  case "$changed_file" in
    rust/cloud-storage/*/src/config.rs)
      crate_path=${changed_file#rust/cloud-storage/}
      crate_path=${crate_path%/src/config.rs}
      ;;
    rust/cloud-storage/*/src/doppler_config.rs)
      crate_path=${changed_file#rust/cloud-storage/}
      crate_path=${crate_path%/src/doppler_config.rs}
      ;;
    rust/cloud-storage/*/Cargo.toml)
      crate_path=${changed_file#rust/cloud-storage/}
      crate_path=${crate_path%/Cargo.toml}
      ;;
    *)
      continue
      ;;
  esac
  if [[ -n "$crate_path" ]]; then
    crate_paths["$crate_path"]=1
  fi
done < "$changed_files"

if [[ ${#crate_paths[@]} -eq 0 ]]; then
  exit 0
fi

bin_names_file=$(mktemp)
trap 'rm -f "$bin_names_file"' EXIT

for crate_path in "${!crate_paths[@]}"; do
  crate_dir="$repo_root/rust/cloud-storage/$crate_path"
  manifest="$crate_dir/Cargo.toml"
  doppler_config="$crate_dir/src/doppler_config.rs"

  if [[ ! -f "$manifest" || ! -f "$doppler_config" ]]; then
    continue
  fi

  python3 - "$manifest" "$crate_path" >> "$bin_names_file" <<'PY'
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    print("python3 with tomllib support is required", file=sys.stderr)
    raise SystemExit(1)

manifest_path = Path(sys.argv[1])
crate_path = sys.argv[2]
doppler_config_path = "src/doppler_config.rs"

try:
    manifest = tomllib.loads(manifest_path.read_text())
except (OSError, tomllib.TOMLDecodeError) as error:
    print(f"Failed to read Cargo manifest for {crate_path}: {error}", file=sys.stderr)
    raise SystemExit(1)

matching_bins = [
    bin_config
    for bin_config in manifest.get("bin", [])
    if bin_config.get("path") == doppler_config_path
]

if not matching_bins:
    print(
        f"cloud-storage crate '{crate_path}' has {doppler_config_path} "
        f"but no [[bin]] with path = \"{doppler_config_path}\" in {manifest_path}",
        file=sys.stderr,
    )
    raise SystemExit(1)

for bin_config in matching_bins:
    bin_name = bin_config.get("name")
    if not bin_name:
        print(
            f"cloud-storage crate '{crate_path}' has a [[bin]] with "
            f"path = \"{doppler_config_path}\" but no name in {manifest_path}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    print(bin_name)
PY
done

LC_ALL=C sort -u "$bin_names_file"
