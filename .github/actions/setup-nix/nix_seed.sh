#!/usr/bin/env bash
set -euo pipefail

# Keep a copy of /nix with the dev shell in Namespace's HTTP cache. A job on an empty
# volume restores it instead of installing Nix and downloading the shell, which takes
# about a minute longer and depends on cache.nixos.org. It is split into shards because
# one stream from the cache varies between 70 and 190 MB/s. About one transfer in three
# stalls partway, so a restore that runs over restore_limit falls back to the install.

action="$1"
shards=8
restore_limit=40

credentials="$(mktemp "$RUNNER_TEMP/nix-seed.XXXXXX")"
work="$(mktemp -d "$RUNNER_TEMP/nix-seed-shards.XXXXXX")"
trap 'rm -rf "$credentials" "$work"' EXIT

# Forks have no remote cache credentials.
nsc cache sccache setup --cache_name "$NIX_SEED_CACHE" > "$credentials"
endpoint="$(sed -n 's/^SCCACHE_WEBDAV_ENDPOINT=//p' "$credentials")"
token="$(sed -n 's/^SCCACHE_WEBDAV_TOKEN=//p' "$credentials")"
echo "::add-mask::$token"

base="$endpoint/nix-seed/$NIX_SEED_KEY"

# The token goes through a config descriptor so it stays out of curl's arguments.
cache_request() {
  curl --fail --silent --show-error --speed-limit 1048576 --speed-time 20 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$token") "$@"
}

wait_all() {
  local failed=0 pid
  for pid in "$@"; do
    wait "$pid" || failed=1
  done

  return "$failed"
}

restore() {
  local pids=() shard
  for shard in $(seq 0 $((shards - 1))); do
    (cache_request --max-time "$restore_limit" "$base/$shard" | zstd -d -T2 | sudo tar -xf - -C /) &
    pids+=("$!")
  done

  wait_all "${pids[@]}"
}

# Largest entries first, dealt in turn, so the shards come out about the same size.
# .links only holds hard links to files that are in the store anyway.
split_store() {
  sudo find /nix /nix/store -mindepth 1 -maxdepth 1 ! -path /nix/store ! -path /nix/store/.links -print0 \
    | sudo xargs -0 du -s \
    | sort -rn \
    | cut -f2- \
    | sed 's#^/##' \
    | awk -v shards="$shards" -v work="$work" '{ print > (work "/" (NR % shards)) }'
}

save() {
  local pids=() shard
  split_store

  for shard in $(seq 0 $((shards - 1))); do
    (
      sudo tar -C / -cf - -T "$work/$shard" | zstd -T2 -3 -q -o "$work/$shard.tar.zst"
      cache_request --upload-file "$work/$shard.tar.zst" "$base/$shard"
    ) &
    pids+=("$!")
  done

  wait_all "${pids[@]}"
}

case "$action" in
  restore)
    # No seed yet: the job installs from scratch and saves one once its dev shell is ready.
    if ! cache_request --head --output /dev/null "$base/0"; then
      {
        echo "NIX_SEED_SAVE=true"
        echo "NIX_SEED_CACHE=$NIX_SEED_CACHE"
        echo "NIX_SEED_KEY=$NIX_SEED_KEY"
      } >> "$GITHUB_ENV"
      exit 1
    fi

    if restore; then
      echo "Restored /nix from the seed"
      exit 0
    fi

    # An interrupted restore leaves a store that looks installed.
    sudo find /nix -mindepth 1 -delete
    exit 1
    ;;
  save)
    # Nothing writes to the store between the dev shell and this step.
    save
    echo "Saved /nix to the seed"
    ;;
esac
