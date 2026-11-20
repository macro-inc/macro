# Addresses of the local stack instance the differential runs on. Source it
# from inside `nix develop` (psql, redis-cli and just come from there).
# PROOF_INSTANCE names the run_local instance; its ports come from up.log.
: "${PROOF_INSTANCE:=gqlns}"
: "${PROOF_REPO:?set PROOF_REPO to the worktree that runs the stack}"
up="$PROOF_REPO/infra/local/generated/$PROOF_INSTANCE/run/up.log"
pick() { grep -E "^  $1 " "$up" | tail -1 | awk '{print $2}'; }
export PROOF_INSTANCE PROOF_REPO
export PROOF_PROXY_URL="$(pick proxy)"
export PROOF_DATABASE_URL="$(pick postgres)"
export PROOF_REDIS_URL="$(pick redis)"
export PROOF_SQS_URL="$(pick localstack)"
export PROOF_CA_PEM="$PROOF_REPO/infra/local/certs/ca.pem"
export NODE_EXTRA_CA_CERTS="$PROOF_CA_PEM"
export PROOF_HOSTNAME="$(hostname | tr '[:upper:]' '[:lower:]')"
# The backend prefixes the dev server proxies (xtask_local proxy::frontend_path_prefixes).
export PROOF_ROUTES="${PROOF_ROUTES:-/auth,/connection-gateway,/contacts,/dss,/email,/calendar,/notification,/unfurl,/image-proxy,/agent-harness,/preview,/scheduled-action,/cognition,/mcp,/websocket,/sync,/i,/lexical,/ai-editing,/static-file,/local-storage}"
export PROOF_QUEUE_URL="${PROOF_SQS_URL}/000000000000/notification-ingress-queue"
