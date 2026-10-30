# Research

## `vendor-auth.csv`

How each app Macro users connect through Pipedream authenticates, gathered
2026-10-30 by probing each vendor's MCP server ([`../probing.md`](../probing.md))
and reading its docs. `verified` says which.

`pipedream_connections` is Macro's count of Pipedream connections for the app
on 2026-10-30, from the production read replica's
`pipedream_mcp_connections` table. Re-measure with
`tooling/scripts/mcp_connection_usage.sh` (Macro side; needs an SSM port
forward to the replica, see the script's header).

`custom_oauth_app` is `yes` when Macro Connect needs its own OAuth app. One
row is misleading: Granola's MCP server supports CIMD and DCR (no own app);
only its REST API is API-key-only.
