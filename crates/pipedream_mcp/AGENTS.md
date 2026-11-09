# pipedream_mcp

## What it is

Part of the AI agent tools feature. Lets users connect third-party apps
through Pipedream Connect (Pipedream owns grants/tokens/refresh), and the
AI loop calls their tools through Pipedream's remote MCP server. A user the
`macro-connect` flag is on for is on Macro Connect alone (Macro's own OAuth
apps; Connect owns grants and refresh): directory, connect flow, tool
listings, and calls all go through Connect, with no Pipedream fallback.

## Start here

- `src/lib.rs`: crate doc comment — explains why this is fully separate from
  the native `mcp_client` stack.
- `src/domain/ports.rs` + `src/domain/models.rs`: connection model and ports.
- `src/outbound/api.rs`: the Pipedream HTTP API client, including the
  Connect API proxy (`ConnectedAppProxy`) that calls an app's own REST API
  with the account's credentials; catalog entries preserve Pipedream category
  labels for clients to group without a local taxonomy. `HIDDEN_APP_SLUGS`
  are never offered.
- `src/outbound/pg_connection_repo.rs`: the `pipedream_mcp_connections` table,
  and the `mcp_overlays` table (`ConnectorOverlays`): catalog apps that connect
  through their own MCP server on the native stack instead of Pipedream.
  Connection reads skip overlaid slugs, and `complete_pipedream_connection`
  (also reached through `recover_pipedream_connection`)
  refuses them (409) and deletes the new Pipedream account.
- `src/inbound/toolset.rs`: how connected apps surface as agent tools.
- `src/outbound/connect.rs`: the Macro Connect adapter over
  `connect_client` (a pinned copy of Connect's client): tools through Connect's
  MCP gateway, app API calls with an exported access token, catalog apps
  addressed by the Pipedream slugs they replace, or by their Connect id when
  Pipedream has no such app.
- `src/outbound/dispatch.rs`: `ConnectorBackends`, the one type hosts wire:
  it holds the host's `ConnectRollout` (the `macro-connect` PostHog flag,
  read by `ai_tools::macro_connect_rollout`). A user on Connect alone gets
  Connect's directory and tool listings, and their Pipedream rows are
  refused; everyone else stays on Pipedream. A Connect row always reaches
  Connect.
- `src/domain/service/connect.rs`: `start_connect_session` and
  `complete_connect_connection` record Connect connections; the router only
  calls them for users on Connect alone (`MacroConnect::connect_only`).

## Scope

- Owns: Pipedream connect-flow state, the `pipedream_mcp_connections` table,
  the `mcp_overlays` table,
  and loading a user's Pipedream tools into the agent toolset.
- Not here: deciding whether a user's tools come from Pipedream or the native
  MCP stack → `mcp_select`.

## Boundaries

- Depends on: `ai_toolset`, `mcp_toolset`, `macro_authorization`,
  `macro_user_id`, `connect_client` (the only Connect crate Macro may use).
- Used by: `ai_tools`, `import_notion`, `import_tracker`, `import_linear`,
  `import_jira`, `agent_egress`, `agent_harness`,
  `granola_sync`, `mcp_select`, `services/agent_harness_service`.

## Gotchas

- A `provider = connect` row stores Connect's app id in `account_id` and keeps
  the Pipedream slug in `app_slug`, so `mcp_select` and agent egress need no
  changes. Granola connects through Connect like any app (an MCP grant).
  Granola meeting sync still reads Granola's API-key REST API, so it only
  syncs Pipedream-held Granola accounts; sync over Granola's MCP server is
  follow-up work.
- The Connect consent redirect (`/pipedream/mcp/connect/callback`) is public
  and records nothing; the app polls `/pipedream/mcp/connect/complete`, which
  trusts only Connect's own connection list.

- Completing a connection (Pipedream, its recovery, or Connect) turns the app
  on, even over a row the user disabled: the app reads a disabled result as a
  failed connect, and agent discovery reports a disabled app as unconnected.
- A Macro Connect grant outranks an overlay: the store returns it, and
  status checks read it before the overlay's native connection.
- Overlaying an app hides its Pipedream grant from every reader, including
  imports (Linear, Jira, Notion) and Granola sync, which use the Pipedream
  proxy. Keep those slugs out of `mcp_overlays` until their readers have a
  native path.
- Discovery answers an overlaid app's connection status through
  `OverlayConnections` (implemented in `mcp_select` over the native store); its
  advertised tools still come from Pipedream's listing for the slug.
- `github` is overlaid, but its native server is authorized by the GitHub
  account link (`mcp_client`'s `WithLinkedGithub`), not MCP OAuth; the
  frontend connects it by linking the account.

## Checks

- `cargo test -p pipedream_mcp` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`
