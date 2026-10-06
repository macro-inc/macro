set -euo pipefail

# The Apple linker/SDK live outside Nix. Do not reuse their outputs after the
# runner image changes its macOS or Xcode version.
toolchain_key=$(
  { xcodebuild -version && sw_vers -buildVersion; } |
    shasum -a 256 | awk '{print $1}'
)
cache_dir="$HOME/.cache/macro-desktop-nix/$toolchain_key"
mkdir -p "$cache_dir"
cache_url="file://$cache_dir?compression=zstd&trusted=true&priority=10"

# Initialize an empty cache before adding it as a substituter. Only this local,
# repository-specific cache accepts unsigned paths; public caches still require
# signatures. Keep the normal /nix store and its daemon-managed permissions.
nix store info --store "$cache_url" --json
{
  echo "DESKTOP_NIX_CACHE_URL=$cache_url"
  echo "NIX_CONFIG<<DESKTOP_NIX_CONFIG_EOF"
  printf '%s\n' "${NIX_CONFIG:-}"
  echo "extra-substituters = $cache_url"
  echo "DESKTOP_NIX_CONFIG_EOF"
} >> "$GITHUB_ENV"
