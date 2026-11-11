#!/usr/bin/env bash
# Run Claude Code with only the local stack's public Macro MCP, signed in as a
# local user. The user must already exist (sign in once through the web app).
#
#   tooling/scripts/claude-local-mcp.sh --instance <name> --email <email> [claude args...]
#
# The MCP is served by agent_harness_service; a minted local JWT stands in
# for the OAuth flow.
set -euo pipefail

instance=macro
email=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) instance=$2; shift 2 ;;
    --email) email=$2; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [[ -z "$email" ]]; then
  echo "usage: $0 --instance <name> --email <email> [claude args...]" >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel)
generated="$root/infra/local/generated/$instance"
if [[ ! -f "$generated/portmap.json" ]]; then
  echo "no running stack for instance $instance (missing $generated/portmap.json)" >&2
  exit 1
fi
# The cognition host is the harness listener plus a /cognition prefix; the
# public MCP is mounted at the listener's root.
mcp_url="$(jq -r '.hosts.cognition' "$generated/portmap.json" | sed -E 's#^(https?://[^/]+).*#\1#')/mcp"

set -a
# shellcheck disable=SC1091
source "$generated/local.generated.env"
set +a

fusion_user_id=$(docker exec "macro-$instance-postgres-1" psql -U user -d macrodb -tAc \
  "SELECT id FROM \"User\" WHERE email = '$email'" | tr -d '[:space:]')
if [[ -z "$fusion_user_id" ]]; then
  echo "no user $email in instance $instance; sign in through the web app first" >&2
  exit 1
fi

token=$(cd "$root" && cargo run --quiet -p local_e2e_test_support --bin generate_local_e2e_token -- \
  --email "$email" --macro-user-id "macro|$email" --fusion-user-id "$fusion_user_id" \
  --expiry-seconds 28800)

config=$(mktemp --suffix=.json)
trap 'rm -f "$config"' EXIT
jq -n --arg url "$mcp_url" --arg token "$token" \
  '{mcpServers: {macro: {type: "http", url: $url, headers: {Authorization: ("Bearer " + $token)}}}}' \
  > "$config"

claude --mcp-config "$config" --strict-mcp-config "$@"
