set -euo pipefail

# The Apple linker/SDK live outside Nix. Do not reuse their outputs after the
# runner image changes its macOS or Xcode version.
toolchain_key=$(
  { xcodebuild -version && sw_vers -buildVersion; } |
    shasum -a 256 | awk '{print $1}'
)
cache_root="$HOME/.cache/macro-desktop-nix"
cache_dir="$cache_root/$toolchain_key"
mkdir -p "$cache_dir"
cache_url="file://$cache_dir?compression=zstd&trusted=true&priority=10"

# The mounted cache root is a symlink; the trailing slash measures its contents.
du -sk "$cache_root/" | awk '{printf "Restored macOS Nix cache: %.2f GiB\n", $1 / 1048576}'

# Initialize an empty cache before adding it as a substituter. Only this local,
# repository-specific cache accepts unsigned paths; public caches still require
# signatures. Keep the normal /nix store and its daemon-managed permissions.
nix store info --store "$cache_url" --json
{
  echo "DESKTOP_NIX_CACHE_ROOT=$cache_root"
  echo "DESKTOP_NIX_CACHE_DIR=$cache_dir"
  echo "DESKTOP_NIX_CACHE_URL=$cache_url"
  echo "NIX_CONFIG<<DESKTOP_NIX_CONFIG_EOF"
  printf '%s\n' "${NIX_CONFIG:-}"
  echo "extra-substituters = $cache_url"
  echo "DESKTOP_NIX_CONFIG_EOF"
} >> "$GITHUB_ENV"
