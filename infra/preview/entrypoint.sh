#!/usr/bin/env bash
# Boot for the Fly preview machine: start the inner Docker daemon, load the
# baked images, bring the stack up from the baked artifacts, then idle while
# the containers serve. Everything expensive (compile, bundle, init) happened
# in CI — this script only restores and starts.
set -euo pipefail

log() { echo "[preview] $*"; }

log "starting inner dockerd"
dockerd >/var/log/dockerd.log 2>&1 &

for _ in $(seq 1 120); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
if ! docker info >/dev/null 2>&1; then
  log "dockerd failed to start:"
  tail -n 50 /var/log/dockerd.log
  exit 1
fi

# The inner daemon's state is ephemeral (fresh on every machine create /
# redeploy); suspend/resume keeps it, so this only runs on real boots.
# Per-image tars, loaded in parallel: one monolithic tar made this a serial,
# single-threaded untar+sha256 of ~6GB (observed 15+ minutes on shared
# cores). dockerd serializes layer registration internally, so concurrent
# loads are safe; shared layers settle to one copy. /var/lib/docker is a
# persistent volume, so the manifest (image ID per tag) lets redeploys skip
# every image that is already in the store — only changed images pay the
# load.
if [ -f /srv/macro/preload/manifest.txt ]; then
  log "loading baked images (parallel, warm store aware)"
  t0=$(date +%s)
  pids=""
  while read -r id tag tarfile; do
    have=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
    if [ "$have" = "$id" ]; then
      log "already loaded: $tag"
      continue
    fi
    docker load -i "/srv/macro/preload/images/$tarfile" &
    pids="$pids $!"
  done < /srv/macro/preload/manifest.txt
  rc=0
  for pid in $pids; do wait "$pid" || rc=1; done
  [ "$rc" = 0 ] || { log "docker load failed"; exit 1; }
  log "images loaded in $(($(date +%s) - t0))s"
elif [ -f /srv/macro/preload/images.tar ]; then
  log "loading baked images"
  t0=$(date +%s)
  docker load -i /srv/macro/preload/images.tar
  log "images loaded in $(($(date +%s) - t0))s"
fi

# With a DOPPLER_TOKEN (a config-scoped service token, injected as a Fly
# secret) the env layer pulls the preview secrets; without one the stack runs
# on the code-owned local dummies only.
doppler_args=(--no-doppler)
if [ -n "${DOPPLER_TOKEN:-}" ]; then
  log "DOPPLER_TOKEN present — pulling preview secrets"
  doppler_args=()
fi

log "bringing the stack up (snapshot restore)"
/srv/macro/bin/xtask stack up \
  "${doppler_args[@]}" \
  --no-build \
  --binaries-dir /srv/macro/artifacts/binaries \
  --frontend-dist /srv/macro/artifacts/frontend-dist \
  --json

log "stack ready — proxy serving on :8090"
exec sleep infinity
