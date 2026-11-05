#!/usr/bin/env bash
set -euo pipefail

# Keep a copy of /nix with the dev shell in Namespace's HTTP cache. A job on an empty
# volume restores it instead of installing Nix and downloading the shell, which takes
# about 50 s longer and depends on cache.nixos.org.

action="$1"

credentials="$(mktemp "$RUNNER_TEMP/nix-seed.XXXXXX")"
archive="$RUNNER_TEMP/nix-seed.tar.zst"
trap 'rm -f "$credentials" "$archive"' EXIT

# Forks have no remote cache credentials.
nsc cache sccache setup --cache_name "$NIX_SEED_CACHE" > "$credentials"
endpoint="$(sed -n 's/^SCCACHE_WEBDAV_ENDPOINT=//p' "$credentials")"
token="$(sed -n 's/^SCCACHE_WEBDAV_TOKEN=//p' "$credentials")"
echo "::add-mask::$token"

url="$endpoint/nix-seed/$NIX_SEED_KEY.tar.zst"

# The token goes through a config descriptor so it stays out of curl's arguments.
cache_request() {
  curl --fail --silent --show-error --speed-limit 1048576 --speed-time 20 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"
}

case "$action" in
  restore)
    if cache_request "$url" | zstd -d -T0 | sudo tar -xf - -C /; then
      echo "Restored /nix from the seed"
      exit 0
    fi

    # An interrupted restore leaves a store that looks installed. The job installs
    # from scratch and saves a new seed once its dev shell is ready.
    sudo find /nix -mindepth 1 -delete
    echo "NIX_SEED_SAVE=true" >> "$GITHUB_ENV"
    exit 1
    ;;
  save)
    # Nothing writes to the store between the dev shell and this step.
    sudo tar -C / -cf - nix | zstd -T0 -3 -o "$archive"
    cache_request --upload-file "$archive" "$url"
    echo "Saved /nix to the seed"
    ;;
esac
