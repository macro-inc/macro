#!/usr/bin/env bash
# Boot for the Fly preview machine: start the inner Docker daemon, pull the
# stack images from the app's registry repo, bring the stack up from the baked
# artifacts, then idle while the containers serve. Everything expensive
# (compile, bundle, init) happened in CI — this script only restores and
# starts.
set -euo pipefail

state_dir=/var/lib/docker/.macro-preview
mkdir -p "$state_dir"
# Fly's log stream is short-retention and `flyctl logs --no-tail` can hang
# forever, so the boot breakdown also lands in a volume-backed file that CI
# reads back with a plain `ssh cat`. Truncated here, not appended: the file
# always describes the most recent real boot.
timings="$state_dir/boot-timings.log"
: > "$timings"
log() { echo "[preview] $*" | tee -a "$timings"; }

t_boot=$(date +%s)
# A hard loss during a hot update cannot run its EXIT trap. The full immutable
# boot is the recovery boundary, so clear any abandoned volume-backed lock.
rmdir "$state_dir/update.lock" 2>/dev/null || true
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

# A template-forked volume carries the source deploy's containers; any with a
# restart policy auto-start with dockerd and can answer :8090 with the OLD
# stack — fly-proxy then reports the machine healthy before the real stack
# exists, and a visitor gets the stale app followed by a teardown blackout.
# Kill them before anything can serve; `stack up` recreates properly.
stale=$(docker ps -q)
if [ -n "$stale" ]; then
  log "killing $(echo "$stale" | wc -l) auto-started containers from the volume source"
  echo "$stale" | xargs -r docker kill >/dev/null 2>&1 || true
fi

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
  # The manifest's IDs are the RUNNER's view of each image (for hub images
  # under the containerd store, the source registry's index digest). Pulling
  # the mirror yields a different manifest and therefore a different local
  # .Id, so the inspect check below never matches mirrored images and every
  # boot re-pulled all 16 (66s of pure round-trips on a fully warm volume).
  # The receipt is our own volume-persisted record of which (runner id, tag)
  # pairs this store already satisfied — written only after a fully
  # successful pass, carried along by template-volume forks, and at worst
  # stale in the direction of one redundant pull.
  receipt="$state_dir/pulled.txt"
  pids=""
  while read -r id tag ref; do
    have=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
    if [ "$have" = "$id" ]; then
      log "already present: $tag"
      continue
    fi
    if [ -n "$have" ] && grep -qxF "$id $tag" "$receipt" 2>/dev/null; then
      log "already present (receipt): $tag"
      continue
    fi
    (docker pull -q "$ref" && docker tag "$ref" "$tag" && docker rmi "$ref" >/dev/null) &
    pids="$pids $!"
  done < /srv/macro/preload/manifest.txt
  rc=0
  for pid in $pids; do wait "$pid" || rc=1; done
  [ "$rc" = 0 ] || { log "image pull failed"; exit 1; }
  awk '{print $1, $2}' /srv/macro/preload/manifest.txt > "$receipt.next" \
    && mv "$receipt.next" "$receipt"
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
# tee the per-stage timings into the boot log; pipefail keeps a stack-up
# failure fatal through the pipe.
/srv/macro/bin/xtask stack up \
  "${doppler_args[@]}" \
  --no-build \
  --binaries-dir /srv/macro/artifacts/binaries \
  --frontend-dist /srv/macro/artifacts/frontend-dist \
  --json 2>&1 | tee -a "$timings"

log "stack up took $(($(date +%s) - t0))s (boot total $(($(date +%s) - t_boot))s)"
# The backend health gate is the longest stack-up phase; surface the auth
# service's step timings plus its timestamped tail so the wait is attributable
# from the CI boot-timings step (which ssh-cats the timings file).
docker logs -t macro-authentication-service-1 2>&1 \
  | grep 'authentication startup step' \
  | sed 's/^/[preview][auth-startup] /' | tee -a "$timings" || true
docker logs -t --tail 40 macro-authentication-service-1 2>&1 \
  | sed 's/^/[preview][auth] /' | tee -a "$timings" || true

# Commit the compatibility marker only after the restored stack is healthy.
# It lives beside (not inside) Docker's own data on the persistent volume, so
# CI can distinguish a hot-updatable machine from an absent/partial/old deploy.
install -m 0644 /srv/macro/deployment.json "$state_dir/deployment.json.next"
mv -f "$state_dir/deployment.json.next" "$state_dir/deployment.json"
log "stack ready — proxy serving on :8090"
exec sleep infinity
