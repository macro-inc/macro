#!/usr/bin/env bash
# Apply a registry-carried artifact update to an already-running preview VM.
# Exit 42 asks CI to fall back to a full image deploy/stack rehydrate.
set -euo pipefail

readonly REHYDRATE_EXIT=42
readonly STATE_DIR=/var/lib/docker/.macro-preview
readonly STATE_FILE="$STATE_DIR/deployment.json"

log() { echo "[preview][hot-update] $*"; }
rehydrate() { log "$*; requesting full rehydrate" >&2; exit "$REHYDRATE_EXIT"; }

if [ "$#" -ne 2 ]; then
  echo "usage: hot-update <registry-image> <registry-token-file>" >&2
  exit 2
fi
update_image=$1
token_file=$2

mkdir -p "$STATE_DIR"
if ! mkdir "$STATE_DIR/update.lock" 2>/dev/null; then
  echo "another preview update is already running" >&2
  exit 1
fi

staging=
container=
cleanup() {
  rm -f "$token_file"
  [ -z "$container" ] || docker rm -f "$container" >/dev/null 2>&1 || true
  [ -z "$staging" ] || rm -rf "$staging"
  rmdir "$STATE_DIR/update.lock" 2>/dev/null || true
}
trap cleanup EXIT

[ -s "$token_file" ] || rehydrate "registry pull token is missing"
[ -f "$STATE_FILE" ] || rehydrate "deployment state is missing"

log "pulling artifact image $update_image"
docker login registry.fly.io -u x --password-stdin < "$token_file" >/dev/null
docker pull -q "$update_image"
container=$(docker create "$update_image")
staging=$(mktemp -d /srv/macro/.hot-update.XXXXXX)
docker cp "$container:/update/." "$staging/"
docker rm "$container" >/dev/null
container=

new_format=$(jq -er '.format' "$staging/deployment.json")
new_snapshot=$(jq -er '.snapshot_key' "$staging/deployment.json")
new_runtime=$(jq -er '.runtime_key' "$staging/deployment.json")
new_frontend=$(jq -er '.frontend_key' "$staging/deployment.json")
current_format=$(jq -er '.format' "$STATE_FILE")
current_snapshot=$(jq -er '.snapshot_key' "$STATE_FILE")
current_runtime=$(jq -er '.runtime_key' "$STATE_FILE")
current_frontend=$(jq -er '.frontend_key' "$STATE_FILE")
[ "$new_format" = "1" ] || rehydrate "unsupported update format $new_format"
[ "$current_format" = "$new_format" ] || rehydrate "deployment format changed"
[ "$current_snapshot" = "$new_snapshot" ] || rehydrate "snapshot key changed"
[ "$current_runtime" = "$new_runtime" ] || rehydrate "runtime configuration changed"

# CI mirrors every compose image and puts the desired IDs in the carrier.
# Docker-built leaf services are safe to recreate in place. Any other image
# change is infrastructure/runtime drift and must use the full rehydrate path.
aux_changed=
unsafe_images=
while read -r expected_id tag registry_ref; do
  current_id=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
  [ "$current_id" = "$expected_id" ] && continue
  case "$tag" in
    *-ai_editing_worker|*-lexical_service|*-sync_service|*-websocket_service)
      log "refreshing auxiliary image $tag"
      docker pull -q "$registry_ref"
      pulled_id=$(docker image inspect -f '{{.Id}}' "$registry_ref")
      [ "$pulled_id" = "$expected_id" ] \
        || rehydrate "registry image ID mismatch for $tag"
      docker tag "$registry_ref" "$tag"
      docker rmi "$registry_ref" >/dev/null
      aux_changed=1
      ;;
    *) unsafe_images="$unsafe_images $tag" ;;
  esac
done < "$staging/manifest.txt"
[ -z "$unsafe_images" ] || rehydrate "non-hot-updatable images changed:$unsafe_images"

# SSH sessions don't inherit app secrets. Recover only the config-scoped
# Doppler token from PID 1 without printing it, then let xtask regenerate the
# local env file before recreating/restarting containers.
doppler_token=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^DOPPLER_TOKEN=//p' | head -n 1)
[ -z "$doppler_token" ] || export DOPPLER_TOKEN="$doppler_token"
export MACRO_REPO_ROOT=/srv/macro/repo
export MACRO_STACK_SNAPSHOT_DIR=/srv/macro/artifacts/snapshots

apply_args=(
  stack apply
  --binaries-dir "$staging/binaries"
  --json
)
[ "$current_frontend" = "$new_frontend" ] \
  || apply_args+=(--frontend-dist "$staging/frontend-dist")
[ -z "$aux_changed" ] || apply_args+=(--recreate-aux-services)

log "applying prebuilt artifacts"
"$staging/xtask" "${apply_args[@]}"

# Publish the new orchestrator and compatibility marker only after the stack is
# healthy. A failed apply leaves the old marker, so the next run rehydrates.
install -m 0755 "$staging/xtask" /srv/macro/bin/xtask.next
mv -f /srv/macro/bin/xtask.next /srv/macro/bin/xtask
install -m 0644 "$staging/deployment.json" "$STATE_FILE.next"
mv -f "$STATE_FILE.next" "$STATE_FILE"

# Retain the current carrier's layers for the next incremental pull, but remove
# older carrier tags and their now-unreferenced layers from the persistent store.
repository=${update_image%:*}
while read -r old; do
  case "$old" in
    "$repository":update-*) [ "$old" = "$update_image" ] || docker rmi "$old" >/dev/null || true ;;
  esac
done < <(docker images "$repository" --format '{{.Repository}}:{{.Tag}}')
docker image prune -f >/dev/null || true

log "update complete"
