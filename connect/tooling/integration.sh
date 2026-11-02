#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${CONNECT_CARGO_TARGET_DIR:-}" ]]; then
  export CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"
fi

if [[ $# -ne 1 ]]; then
  echo "usage: $0 local|dev" >&2
  exit 2
fi

case "$1" in
  local)
    compose=(docker compose -p connect-integration -f connect/docker-compose.yml)
    cleanup() { "${compose[@]}" down; }
    trap cleanup EXIT
    "${compose[@]}" up -d --build
    customer_output=$("${compose[@]}" run --rm api create-customer integration --redirect-origin http://localhost:3000)
    if ! customer_key=$(printf '%s\n' "$customer_output" | rg -m 1 '^ck_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$'); then
      echo "create-customer did not return a customer key" >&2
      exit 1
    fi
    unset customer_output
    cargo run --quiet -p connect_integration -- \
      --base-url "http://localhost:${CONNECT_PORT:-8080}" \
      --customer-key "$customer_key" \
      --redirect-origin http://localhost:3000
    ;;
  dev)
    if [[ -z "${CONNECT_IT_CUSTOMER_KEY:-}" ]]; then
      echo "CONNECT_IT_CUSTOMER_KEY is required" >&2
      exit 2
    fi
    cargo run --quiet -p connect_integration -- \
      --base-url https://connect-dev.macro.com \
      --customer-key "$CONNECT_IT_CUSTOMER_KEY" \
      --redirect-origin http://localhost:3000 \
      --follow-vendor
    ;;
  *)
    echo "usage: $0 local|dev" >&2
    exit 2
    ;;
esac
