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
if [ -f /srv/macro/preload/images.tar ]; then
  log "loading baked images"
  docker load -i /srv/macro/preload/images.tar
fi

log "bringing the stack up (snapshot restore)"
/srv/macro/bin/xtask stack up \
  --no-doppler \
  --no-build \
  --binaries-dir /srv/macro/artifacts/binaries \
  --frontend-dist /srv/macro/artifacts/frontend-dist \
  --json

log "stack ready — proxy serving on :8090"
exec sleep infinity
