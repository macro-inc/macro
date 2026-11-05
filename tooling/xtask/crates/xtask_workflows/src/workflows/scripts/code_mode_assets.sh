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

# A job that already installed the JavaScript dependencies runs the same generator
# on them. Output is byte-identical, and Nix would first rebuild its own copy of
# node_modules, which takes minutes when the store doesn't have it. Nothing to
# upload: other jobs look for the store path, which this doesn't produce.
generate_from_install() {
  directory="$RUNNER_TEMP/code-mode-assets"
  (cd packages/sdk && bun install --frozen-lockfile)
  bun packages/code-mode-sdk/scripts/generate.ts "$directory"
  echo "CODE_MODE_ASSETS_DIR=$directory" >> "$GITHUB_ENV"
  echo "Code-mode assets generated from the installed dependencies"
}

# Forks have no remote cache credentials.
if [ -z "${SCCACHE_WEBDAV_ENDPOINT:-}" ]; then
  if [ -n "${CODE_MODE_ASSETS_FROM_INSTALL:-}" ]; then
    generate_from_install
  else
    nix build --no-link --print-build-logs .#code-mode-assets
  fi
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

if [ -n "${CODE_MODE_ASSETS_FROM_INSTALL:-}" ]; then
  generate_from_install
  exit 0
fi

nix build --no-link --print-build-logs .#code-mode-assets

# Losing the upload costs the next job a rebuild, not a failure.
if nix-store --export "$assets" | gzip | cache_request --upload-file - "$cache_url"; then
  echo "Code-mode assets saved to the remote cache"
else
  echo "::warning::Could not save code-mode assets to the remote cache"
fi
