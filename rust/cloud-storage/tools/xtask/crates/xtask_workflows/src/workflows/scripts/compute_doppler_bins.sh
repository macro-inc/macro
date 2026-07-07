set -euo pipefail

doppler_config_bins="$(cargo run --manifest-path rust/cloud-storage/tools/xtask/Cargo.toml -- doppler-bins /tmp/changed-files)"
{
  echo 'doppler_config_bins<<__DOPPLER_CONFIG_BINS__'
  if [ -n "$doppler_config_bins" ]; then
    printf '%s\n' "$doppler_config_bins"
  fi
  echo '__DOPPLER_CONFIG_BINS__'
} >> "$GITHUB_OUTPUT"
