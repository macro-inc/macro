#!/usr/bin/env bash
# Build-time, idempotent repository bootstrap for Cursor Cloud Environment Builds.
#
# Trade-off: this install is a heavy one-time Build (nix flake, bun install,
# cargo-zigbuild of all services, runtime image, infra image pulls, a cold
# `just stack up` that saves the init snapshot) so that later agent boots are
# fast. Processes started here do not survive the snapshot; `.cursor/start.sh`
# brings daemons back on each boot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

bash "${ROOT}/.cursor/start.sh"

export PATH="${HOME}/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

# Pre-pull public infra images so `stack up` is not gated on Hub on first boot.
# Built images (runtime, opensearch, webhook relay) are produced by stack up.
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
)
for img in "${pull_images[@]}"; do
  echo "cursor-cloud install: pulling ${img}"
  docker pull "${img}"
done

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
echo "cursor-cloud install: just stack up --no-doppler (cache warming)"
nix_stack 'just stack up --no-doppler'

echo "cursor-cloud install: just stack down"
nix_stack 'just stack down'

echo "cursor-cloud install: complete"
