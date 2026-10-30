#!/usr/bin/env bash
# Counts which MCP connectors users have connected, from the prod read replica.
# Writes one CSV row per connector across all three sources:
#   pipedream  - pipedream_mcp_connections (one row per user+app)
#   native     - mcp_servers, the in-house OAuth stack (one row per user+url)
#   agent      - agent_mcp_servers, apps selected on agent personas (per bot)
# Usage: tooling/scripts/mcp_connection_usage.sh [out.csv]
#
# Production data: read-only replica only, and only with the human's approval.
# The replica accepts in-VPC traffic only; open a forward first, e.g.
#   aws ssm start-session --region us-east-1 --target <ssm-managed host in the
#     prod VPC> --document-name AWS-StartPortForwardingSessionToRemoteHost \
#     --parameters '{"host":["<replica host>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
# then run with TUNNEL_PORT=15432. Needs psql, doppler, and the SSM plugin.
set -euo pipefail

out="${1:-mcp_usage.csv}"
db_url="$(doppler secrets get DATABASE_URL_READONLY -p global_databases -c prd --plain)"
if [[ -n "${TUNNEL_PORT:-}" ]]; then
    db_url="$(sed -E "s#@[^/]+/#@127.0.0.1:${TUNNEL_PORT}/#" <<<"$db_url")"
fi

read -r -d '' query <<'SQL' || true
WITH conns AS (
    SELECT 'pipedream' AS source, p.app_slug AS connector, p.user_id, p.enabled, p.created_at
    FROM pipedream_mcp_connections p
    UNION ALL
    SELECT 'native', split_part(m.url, '?', 1), m.user_id, m.enabled, m.created_at
    FROM mcp_servers m
),
by_connector AS (
    SELECT
        c.source,
        c.connector,
        count(*)                                                        AS connections,
        count(*) FILTER (WHERE c.enabled)                               AS enabled_connections,
        count(DISTINCT c.user_id)                                       AS users,
        count(DISTINCT c.user_id) FILTER (WHERE u.email NOT ILIKE '%@macro.com') AS external_users,
        count(*) FILTER (WHERE c.created_at > now() - interval '30 days') AS connections_last_30d,
        min(c.created_at)::date                                         AS first_connected,
        max(c.created_at)::date                                         AS last_connected
    FROM conns c
    LEFT JOIN "User" u ON u.id = c.user_id
    GROUP BY c.source, c.connector
    UNION ALL
    SELECT
        'agent',
        a.app_slug,
        count(*),
        count(*),
        count(DISTINCT b.owner_user_id),
        NULL,
        count(*) FILTER (WHERE a.created_at > now() - interval '30 days'),
        min(a.created_at)::date,
        max(a.created_at)::date
    FROM agent_mcp_servers a
    JOIN bots b ON b.id = a.bot_id
    GROUP BY a.app_slug
)
SELECT * FROM by_connector
ORDER BY connections DESC, connector
SQL

psql "$db_url" --no-psqlrc -v ON_ERROR_STOP=1 \
    -c 'SET default_transaction_read_only = on' \
    -c "\\copy (${query//$'\n'/ }) TO '${out}' WITH (FORMAT csv, HEADER)"

echo "wrote ${out}"
