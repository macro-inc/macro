# pipedream_mcp

## What it is

Part of the AI agent tools feature. Lets users connect third-party apps
through Pipedream Connect (Pipedream owns grants/tokens/refresh), and the
AI loop calls their tools through Pipedream's remote MCP server.

## Start here

- `src/lib.rs`: crate doc comment — explains why this is fully separate from
  the native `mcp_client` stack.
- `src/domain/ports.rs` + `src/domain/models.rs`: connection model and ports.
- `src/outbound/api.rs`: the Pipedream HTTP API client, including the
  Connect API proxy (`ConnectedAppProxy`) that calls an app's own REST API
  with the account's credentials; catalog entries preserve Pipedream category
  labels for clients to group without a local taxonomy.
- `src/outbound/pg_connection_repo.rs`: the `pipedream_mcp_connections` table.
- `src/inbound/toolset.rs`: how connected apps surface as agent tools.

## Scope

- Owns: Pipedream connect-flow state, the `pipedream_mcp_connections` table,
  and loading a user's Pipedream tools into the agent toolset.
- Not here: deciding whether a user's tools come from Pipedream or the native
  MCP stack → `mcp_select`.

## Boundaries

- Depends on: `ai_toolset`, `mcp_toolset`, `macro_authorization`,
  `macro_user_id`.
- Used by: `ai_tools`, `import_notion`, `agent_egress`, `agent_harness`,
  `granola_sync`, `mcp_select`, `services/agent_harness_service`.

## Checks

- `cargo test -p pipedream_mcp` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`
