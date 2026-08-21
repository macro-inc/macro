#!/usr/bin/env bash
# Load Nix dockerTools Postgres + Redis and publish them on the CI job's
# localhost ports. Replaces GitHub Actions `services:` pulls of registry images.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"

bash tooling/scripts/load-nix-docker-streams.sh \
  stream-docker-image-local-postgres \
  stream-docker-image-local-redis

if ! docker ps --format '{{.Names}}' | grep -qx postgres; then
  docker rm -f postgres >/dev/null 2>&1 || true
  docker run -d --name postgres \
    --health-cmd 'pg_isready -U user' \
    --health-interval 10s \
    --health-timeout 5s \
    --health-retries 5 \
    --shm-size 1g \
    -e POSTGRES_USER=user \
    -e POSTGRES_PASSWORD=password \
    -e POSTGRES_DB=macrodb \
    -p 5432:5432 \
    macro-local-postgres:dev
fi

if ! docker ps --format '{{.Names}}' | grep -qx redis; then
  docker rm -f redis >/dev/null 2>&1 || true
  docker run -d --name redis \
    --health-cmd 'redis-cli ping' \
    --health-interval 10s \
    --health-timeout 5s \
    --health-retries 5 \
    -p 6379:6379 \
    macro-local-redis:dev
fi

until docker exec postgres pg_isready -U user -d macrodb; do
  sleep 1
done
until docker exec redis redis-cli ping | grep -q PONG; do
  sleep 1
done
