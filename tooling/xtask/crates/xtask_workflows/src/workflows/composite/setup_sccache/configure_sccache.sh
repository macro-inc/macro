set -euo pipefail

sccache_bin="$HOME/.local/bin/sccache"
cache_dir="$HOME/.cache/sccache"
mkdir -p "$cache_dir"

{
  echo "RUSTC_WRAPPER=$sccache_bin"
  echo "SCCACHE_DIR=$cache_dir"
  echo "SCCACHE_CACHE_SIZE=${SCCACHE_CACHE_SIZE:-5G}"
  echo "SCCACHE_BASEDIR=${GITHUB_WORKSPACE:-$PWD}"
} >> "$GITHUB_ENV"

"$sccache_bin" --version
