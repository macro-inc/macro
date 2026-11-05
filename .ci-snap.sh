#!/usr/bin/env bash
# Experiment: move an incremental target/ through Namespace's HTTP cache in parallel shards.
set -uo pipefail

action="$1"
key="$2"
shards=16
base="$SCCACHE_WEBDAV_ENDPOINT/test-snapshot/$key"

request() {
  curl --fail --silent --show-error --max-time 300 \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$SCCACHE_WEBDAV_TOKEN") "$@"
}

case "$action" in
  exists)
    request --output /dev/null "$base/manifest"
    ;;
  pack)
    work="$RUNNER_TEMP/snap"
    mkdir -p "$work"
    start=$(date +%s)
    python3 -I .ci-snap-split.py "$shards" "$work" || exit 1
    pids=()
    for i in $(seq 0 $((shards - 1))); do
      (
        tar -C / -cf - -T "$work/shard$i.list" | zstd -T2 -3 -q -o "$work/shard$i.tar.zst" \
          && request --upload-file "$work/shard$i.tar.zst" "$base/shard$i"
      ) &
      pids+=($!)
    done
    rc=0
    for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
    du -ch "$work"/shard*.tar.zst | tail -1
    echo "pack_seconds=$(( $(date +%s) - start )) rc=$rc"
    [ "$rc" -eq 0 ] || exit 1
    printf '%s\n' "$shards" | request --upload-file - "$base/manifest"
    ;;
  restore)
    start=$(date +%s)
    pids=()
    for i in $(seq 0 $((shards - 1))); do
      (request "$base/shard$i" | zstd -d -T2 | tar -xf - -C /) &
      pids+=($!)
    done
    rc=0
    for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
    echo "restore_seconds=$(( $(date +%s) - start )) rc=$rc"
    du -sh target "$HOME/.cargo/registry"
    df -h . | tail -1
    [ "$rc" -eq 0 ]
    ;;
esac
