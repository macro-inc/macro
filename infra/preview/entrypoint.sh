#!/usr/bin/env bash
# Boot for the Fly preview machine: start the inner Docker daemon, pull the
# stack images from the app's registry repo, bring the stack up from the baked
# artifacts, then idle while the containers serve. Everything expensive
# (compile, bundle, init) happened in CI — this script only restores and
# starts.
set -euo pipefail

log() { echo "[preview] $*"; }

t_boot=$(date +%s)
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
log "dockerd ready in $(($(date +%s) - t_boot))s"

# Pull the stack images from the app's Fly registry repo (CI mirrored them
# there at deploy time). /var/lib/docker is a persistent volume, so the
# manifest (image ID per tag) lets redeploys skip every image already in the
# store, and pulls dedup at the layer level — only layers that actually
# changed cross the network. Suspend/resume never re-runs this; only real
# boots do. REGISTRY_PULL_TOKEN is an app-scoped deploy token staged as a Fly
# secret by the workflow.
if [ -f /srv/macro/preload/manifest.txt ]; then
  if [ -n "${REGISTRY_PULL_TOKEN:-}" ]; then
    docker login registry.fly.io -u x --password-stdin <<<"$REGISTRY_PULL_TOKEN"
  fi
  log "pulling stack images (parallel, warm store aware)"
  t0=$(date +%s)
  pids=""
  while read -r id tag ref; do
    have=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
    if [ "$have" = "$id" ]; then
      log "already present: $tag"
      continue
    fi
    (docker pull -q "$ref" && docker tag "$ref" "$tag" && docker rmi "$ref" >/dev/null) &
    pids="$pids $!"
  done < /srv/macro/preload/manifest.txt
  rc=0
  for pid in $pids; do wait "$pid" || rc=1; done
  [ "$rc" = 0 ] || { log "image pull failed"; exit 1; }
  log "images pulled in $(($(date +%s) - t0))s"
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
t0=$(date +%s)
/srv/macro/bin/xtask stack up \
  "${doppler_args[@]}" \
  --no-build \
  --binaries-dir /srv/macro/artifacts/binaries \
  --frontend-dist /srv/macro/artifacts/frontend-dist \
  --json

log "stack up took $(($(date +%s) - t0))s (boot total $(($(date +%s) - t_boot))s)"
# The backend health gate is the longest stack-up phase; surface the auth
# service's own timestamped startup log so the wait is attributable from the
# CI boot-timings step (which greps [preview] out of `flyctl logs`).
docker logs -t --tail 40 macro-authentication-service-1 2>&1 \
  | sed 's/^/[preview][auth] /' || true
log "stack ready — proxy serving on :8090"
exec sleep infinity
