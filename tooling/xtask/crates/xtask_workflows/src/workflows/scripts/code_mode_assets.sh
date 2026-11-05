set -euo pipefail

# Build the code-mode assets once per SDK state, not once per job. Cache volumes
# are forks of past jobs, so most jobs miss the store path another job just built.
# Keying on the store path means a hit is exactly what `nix build` would produce.
assets="$(nix eval --raw .#code-mode-assets.outPath)"
echo "CODE_MODE_ASSETS_DIR=$assets" >> "$GITHUB_ENV"

if [ -e "$assets" ]; then
  echo "Code-mode assets already in the store"
  exit 0
fi

# Forks have no remote cache credentials.
if [ -z "${SCCACHE_WEBDAV_ENDPOINT:-}" ]; then
  nix build --no-link --print-build-logs .#code-mode-assets
  exit 0
fi

cache_url="$SCCACHE_WEBDAV_ENDPOINT/code-mode-assets/$(basename "$assets").closure.gz"

cache_request() {
  curl --fail --silent --show-error --max-time 30 --retry 2 \
    --header "Authorization: Bearer $SCCACHE_WEBDAV_TOKEN" "$@"
}

if cache_request "$cache_url" | gunzip | nix-store --import; then
  echo "Code-mode assets restored from the remote cache"
  exit 0
fi

nix build --no-link --print-build-logs .#code-mode-assets

# Losing the upload costs the next job a rebuild, not a failure.
if nix-store --export "$assets" | gzip | cache_request --upload-file - "$cache_url"; then
  echo "Code-mode assets saved to the remote cache"
else
  echo "::warning::Could not save code-mode assets to the remote cache"
fi
