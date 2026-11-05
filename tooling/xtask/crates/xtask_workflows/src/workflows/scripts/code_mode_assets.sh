set -euo pipefail

# Build the code-mode assets once per SDK state, not once per job. Cache volumes
# are forks of past jobs, so most jobs miss the store path another job just built.
# The key is the store path, which covers every input of the build.
assets="$(nix eval --raw .#code-mode-assets.outPath)"
echo "CODE_MODE_ASSETS_DIR=$assets" >> "$GITHUB_ENV"

if nix-store --check-validity "$assets" 2>/dev/null; then
  echo "Code-mode assets already in the store"
  exit 0
fi

# Forks have no remote cache credentials.
if [ -z "${SCCACHE_WEBDAV_ENDPOINT:-}" ]; then
  nix build --no-link --print-build-logs .#code-mode-assets
  exit 0
fi

cache_url="$SCCACHE_WEBDAV_ENDPOINT/code-mode-assets/$(basename "$assets").closure.gz"

# The token goes through a config descriptor so it stays out of curl's arguments.
cache_request() {
  curl --fail --silent --show-error --max-time 30 --retry 2 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}

if cache_request "$cache_url" | gunzip | nix-store --import; then
  echo "Code-mode assets restored from the remote cache"
  exit 0
fi

# Installing node_modules is most of a build and changes far less often than the SDK,
# so it has its own entry.
modules="$(nix eval --raw .#macro-js-node-modules.outPath)"
modules_url="$SCCACHE_WEBDAV_ENDPOINT/code-mode-assets/$(basename "$modules").zst"
save_modules=false

if ! nix-store --check-validity "$modules" 2>/dev/null; then
  if cache_request --max-time 60 "$modules_url" | zstd -d | nix-store --import; then
    echo "node_modules restored from the remote cache"
  else
    save_modules=true
  fi
fi

nix build --no-link --print-build-logs .#code-mode-assets

if [ "$save_modules" = true ] \
  && ! nix-store --export "$modules" | zstd -T0 -3 | cache_request --max-time 120 --upload-file - "$modules_url"; then
  echo "::warning::Could not save node_modules to the remote cache"
fi

# Losing the upload costs the next job a rebuild, not a failure.
if nix-store --export "$assets" | gzip | cache_request --upload-file - "$cache_url"; then
  echo "Code-mode assets saved to the remote cache"
else
  echo "::warning::Could not save code-mode assets to the remote cache"
fi
