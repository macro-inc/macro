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

# The token goes through a config descriptor so it stays out of curl's arguments.
cache_request() {
  curl --fail --silent --show-error --max-time 30 --retry 2 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}

# Forks have no remote cache credentials.
cache_url=""
if [ -n "${SCCACHE_WEBDAV_ENDPOINT:-}" ]; then
  cache_url="$SCCACHE_WEBDAV_ENDPOINT/code-mode-assets/$(basename "$assets").closure.gz"
  if cache_request "$cache_url" | gunzip | nix-store --import; then
    echo "Code-mode assets restored from the remote cache"
    exit 0
  fi
fi

# Pin what to build now: a later step may rewrite the sources (some jobs
# regenerate the SDK) while the build runs.
drv="$(nix eval --raw .#code-mode-assets.drvPath)"

# Installing node_modules is most of a build and changes far less often than the
# SDK, so it has its own entry.
modules=""
modules_url=""
save_modules=false
if [ -n "$cache_url" ]; then
  modules="$(nix eval --raw .#macro-js-node-modules.outPath)"
  modules_url="$SCCACHE_WEBDAV_ENDPOINT/code-mode-assets/$(basename "$modules").zst"
fi

# Returns the build's status, so callers can run it under `if`.
build() {
  if [ -n "$modules" ] && ! nix-store --check-validity "$modules" 2>/dev/null; then
    # No retries: a retry would restart the stream into the same pipe, and past the
    # limit a rebuild is faster.
    if cache_request --retry 0 --max-time 60 "$modules_url" | zstd -d | nix-store --import; then
      echo "node_modules restored from the remote cache"
    else
      save_modules=true
    fi
  fi
  nix build --no-link --print-build-logs "$drv^out"
}

# Losing an upload costs the next job a rebuild, not a failure. Each closure is
# exported in full before it is sent: a stream cut short (Teardown Nix kills what
# still runs at the end of a job) would still compress to a valid entry.
save() {
  [ -n "$cache_url" ] || return 0
  local closure="$RUNNER_TEMP/code-mode-assets.closure"
  if [ "$save_modules" = true ] \
    && ! { nix-store --export "$modules" > "$closure" \
      && zstd -T0 -3 -c "$closure" | cache_request --max-time 120 --upload-file - "$modules_url"; }; then
    echo "::warning::Could not save node_modules to the remote cache"
  fi
  if nix-store --export "$assets" > "$closure" \
    && gzip -c "$closure" | cache_request --upload-file - "$cache_url"; then
    echo "Code-mode assets saved to the remote cache"
  else
    echo "::warning::Could not save code-mode assets to the remote cache"
  fi
  rm -f "$closure"
}

# A kept build script that already ran with this path won't run again to wait for
# it, yet its crate may recompile and read it. Build before cargo then.
if grep -sqF "CODE_MODE_ASSETS=$assets" target/*/build/code_mode_assets-*/output; then
  echo "The kept target was built with these assets; building them before cargo"
  build
  save
  exit 0
fi

# Otherwise build while cargo compiles the rest of the workspace. The crate's build
# script waits for the status file in CODE_MODE_ASSETS_READY, which holds `ok` or
# the end of the build log, and reads the log next to it if the build never ends.
# A job that never compiles the crate never waits, and never sees a failed build.
log="$RUNNER_TEMP/code-mode-assets.log"
status="$RUNNER_TEMP/code-mode-assets.status"
rm -f "$status"
echo "CODE_MODE_ASSETS_READY=$status" >> "$GITHUB_ENV"
# shellcheck disable=SC2094 # the log is read only after the build stops writing it
(
  if build; then
    echo ok > "$status.tmp"
    mv "$status.tmp" "$status"
    save
  else
    { echo "Building .#code-mode-assets failed:"; tail -n 60 "$log"; } > "$status.tmp"
    mv "$status.tmp" "$status"
  fi
) > "$log" 2>&1 < /dev/null &
echo "Building the code-mode assets while cargo runs; log in $log"
