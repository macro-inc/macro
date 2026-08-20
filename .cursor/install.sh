#!/usr/bin/env bash
# Build-time, idempotent repository bootstrap for Cursor Cloud Environment Builds.
#
# Trade-off: this install is a heavy one-time Build (nix flake, bun install,
# cargo-zigbuild of all services, runtime image, infra image pulls, aux image
# builds, a cold `just stack up` that saves the init snapshot) so that later
# agent boots are fast. Processes started here do not survive the snapshot;
# `.cursor/start.sh` brings daemons back on each boot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

bash "${ROOT}/.cursor/start.sh"

export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"
# Nested compose bake otherwise fans out apt-get against Fastly and 400s.
export COMPOSE_PARALLEL_LIMIT=1
export COMPOSE_BAKE=false
export DOCKER_BUILDKIT=1

retry() {
  local desc="$1"
  local attempts="$2"
  shift 2
  local n
  for n in $(seq 1 "${attempts}"); do
    echo "cursor-cloud install: ${desc} (attempt ${n}/${attempts})"
    if "$@"; then
      return 0
    fi
    echo "cursor-cloud install: ${desc} attempt ${n} failed" >&2
    if [ "${n}" -eq "${attempts}" ]; then
      return 1
    fi
    sleep $((n * 8))
  done
}

# Pre-pull public images so `stack up` is not gated on Hub on first boot.
pull_images=(
  "pgvector/pgvector:pg18"
  "redis/redis-stack:latest"
  "apache/kafka:3.9.1"
  "postgres:16.0-bookworm"
  "fusionauth/fusionauth-app:1.62.1"
  "localstack/localstack:4"
  "axllent/mailpit:v1.20"
  "caddy:2-alpine"
  "nginx:alpine"
  "rust:1.94.0-bookworm"
  "node:22-bookworm-slim"
  "node:22-slim"
  "oven/bun:1"
  "alpine:3.22"
  "opensearchproject/opensearch:3.5.0"
)
for img in "${pull_images[@]}"; do
  retry "docker pull ${img}" 3 docker pull "${img}"
done

# Nested BuildKit RUN apt-get over the Docker bridge hits Fastly with HTTP 400
# (DinD MTU / parallel fetches). Build with --network=host so apt uses the VM
# stack; compose up then reuses the tagged images instead of rebaking.
docker_build_host() {
  local tag="$1"
  local dockerfile="$2"
  local context="$3"
  shift 3
  retry "docker build ${tag}" 3 \
    docker build --network=host --progress=plain -t "${tag}" -f "${dockerfile}" "${context}" "$@"
}

echo "cursor-cloud install: pre-building aux images (host network)"
docker_build_host macro-analytics_proxy docker/analytics-proxy.Dockerfile .
docker_build_host macro-ai_editing_worker docker/ai-editing-worker.Dockerfile .
docker_build_host macro-websocket_service docker/websocket-service.Dockerfile .
docker_build_host macro-sdk-webhook-relay:dev infra/local/sdk-webhook-relay/Dockerfile infra/local/sdk-webhook-relay
docker_build_host macro-local-opensearch:dev infra/local/opensearch/Dockerfile infra/local/opensearch
docker_build_host macro-lexical_service docker/lexical-service.Dockerfile . \
  --build-arg "GITHUB_PACKAGES_TOKEN=${GITHUB_PACKAGES_TOKEN:-}"
docker_build_host macro-sync_service docker/sync-service.Dockerfile .

nix_stack() {
  nix develop --command bash -c 'export PATH=$HOME/.nix-profile/bin:$PATH; '"$*"
}

echo "cursor-cloud install: bun install"
nix_stack 'bun install --frozen-lockfile'

echo "cursor-cloud install: doctor-local"
nix_stack 'just doctor-local'

# Cold stack up cross-compiles services, builds the runtime image, initializes
# FusionAuth/Postgres/OpenSearch, and writes infra/local/generated/.snapshots.
# stack down then drops running containers/volumes; images, cargo/sccache, the
# nix store, and the init snapshot stay on disk for the Build snapshot.
stack_up_or_reset() {
  if nix_stack 'export COMPOSE_PARALLEL_LIMIT=1 COMPOSE_BAKE=false DOCKER_BUILDKIT=1; just stack up --no-doppler'; then
    return 0
  fi
  nix_stack 'just stack down' || true
  return 1
}

if ! retry "just stack up --no-doppler" 3 stack_up_or_reset; then
  echo "cursor-cloud install: stack up failed after retries" >&2
  exit 1
fi

echo "cursor-cloud install: just stack down"
nix_stack 'just stack down'

echo "cursor-cloud install: complete"
