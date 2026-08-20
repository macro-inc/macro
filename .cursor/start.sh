#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=cloud-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloud-lib.sh"

ensure_nix_daemon
ensure_dockerd
ensure_just_sqlx
ensure_persistent_caches

cd /workspace
just run_dbs -d

if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432
else
  timeout 5 bash -c 'echo >/dev/tcp/127.0.0.1/5432'
fi

echo "cursor-cloud start: infra ready"
