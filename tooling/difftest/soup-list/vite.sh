#!/usr/bin/env bash
# Serves one checkout's web app against a running local stack, with the probe
# copied in. Usage: vite.sh <checkout> <port> <probe-dir> <cache:on|off> <stack-proxy>
# Runs in the foreground; the runner owns the process and stops it.
set -euo pipefail
checkout=$1 port=$2 probe=$3 cache=$4 proxy=$5
app="$checkout/apps/web"
rm -rf "$app/src/difftest-probe"
cp -r "$probe" "$app/src/difftest-probe"
trap 'rm -rf "$app/src/difftest-probe"' EXIT
trap 'exit 143' INT TERM
\cd "$app"
routes=/auth,/connection-gateway,/contacts,/dss,/email,/calendar,/notification,/unfurl,/image-proxy,/agent-harness,/preview,/scheduled-action,/cognition,/mcp,/websocket,/sync,/i,/lexical,/ai-editing,/static-file,/local-storage
env PORT="$port" \
  VITE_LOCAL_SERVERS=ALL \
  MACRO_LOCAL_HOSTNAME="$(hostname)" \
  NODE_EXTRA_CA_CERTS="$checkout/infra/local/certs/ca.pem" \
  VITE_LOCAL_BACKEND_ORIGIN=same-origin \
  MACRO_LOCAL_BACKEND_PROXY="$proxy" \
  MACRO_LOCAL_BACKEND_ROUTES="$routes" \
  VITE_AI_EDITING_WORKER_URL=/ai-editing \
  VITE_LOCAL_STACK=true \
  VITE_OTEL_EXPORTER_URL=/i/otlp/v1/traces \
  VITE_OTEL_ENV=local \
  VITE_ENABLE_BROWSER_OTEL=true \
  VITE_DISABLE_BROWSER_TURSO_CACHE="$([ "$cache" = off ] && echo true || echo false)" \
  node "$checkout/node_modules/vite/bin/vite.js" -c vite.config.ts --clearScreen false --host 127.0.0.1
