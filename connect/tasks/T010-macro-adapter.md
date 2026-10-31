# T010: Macro uses Connect behind `pipedream_mcp`'s ports

Depends on T008 and T009. This is Macro-side work: it changes Macro crates and
services, and depends on Connect only through `connect_client`.

## Goal

Macro connects users and runs their tools through Macro Connect for every app
in Connect's catalog, falling back to Pipedream only for apps Connect lacks,
behind a feature flag, without changing the shape of Macro's routes, tool
selection, or agent egress.

## Context

Macro's Pipedream integration is `crates/pipedream_mcp`. Everything goes
through its ports (`src/domain/ports.rs`): `ConnectionStore` and
`AppConnections` (Postgres table `pipedream_mcp_connections`),
`McpConnection` and `McpUpstream` (tool calls), `PipedreamConnect`
(connect token, account lookup, delete), `ConnectorDirectory` (catalog),
`ConnectorCapabilities` (tool list), `ApiProxy` (Granola sync only).
Composition roots: `services/document_cognition_service/src/server.rs`
(:576-680, :990-1009), `services/agent_harness_service/src/main.rs`
(:447-477), `services/mcp_service/src/context.rs` (:502-591),
`crates/ai_tools/src/mcp_app_catalog.rs:35`. Web: connect flow in
`apps/web/src/lib/queries/pipedream-connectors.ts` (`connectPipedreamApp`)
and `apps/web/src/lib/core/pipedream/`.

Read `.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md`, the
`AGENTS.md` of every crate you touch, `.agents/rules/config-and-service-urls.md`
(Connect's URL goes in `macro_service_urls` and its copies), and the
`feature-flags` skill.

## Do

1. **Provider on each connection.** Migration adding `provider text not null
   default 'pipedream'` (`pipedream` | `connect`) to
   `pipedream_mcp_connections`; `PipedreamConnection` gains the enum. For
   `connect`, `account_id` holds Connect's `app_id` and `app_slug` stays the
   Pipedream slug the catalog maps to (so `mcp_select` and agent egress keep
   working unchanged).
2. **Connect adapter** in `pipedream_mcp/src/outbound/connect.rs`, over
   `connect_client`, implementing for `provider = connect` records:
   `McpConnection`/`McpUpstream` (dial `mcp_upstream`),
   `ConnectorDirectory` (Connect catalog, mapped to Pipedream slugs via each
   app's `pipedream_app_slugs`), `ConnectorCapabilities` (tool list through
   the gateway). A dispatching adapter picks Connect or Pipedream per record
   or per app: Connect when the app is in Connect's catalog and the flag is
   on, Pipedream otherwise.
3. **Connect flow.** `POST /pipedream/mcp/token` gains an `app_slug`; for a
   Connect app it returns Connect's `connect_url` (from
   `create_connect_session`, redirect back to a Macro route) instead of a
   Pipedream token. The redirect route confirms the connection with
   `connections()` and saves the record with `provider = connect`, then runs
   the same completion hook. Disconnect calls `delete_connection`.
4. **Web.** When the token response is a Connect URL, open it in a popup (web)
   or browser tab (desktop, as `connect-native.tsx` does) instead of
   Pipedream's iframe, and complete on the redirect. Keep the Pipedream path
   for other apps.
5. **Config.** `CONNECT_CUSTOMER_KEY` in Doppler for each service that needs
   it (dev, prd, lcl_personal, `BootStubEnv` placeholder); Connect's base URL
   via `macro_service_urls` (`local` `http://localhost:8080`). Feature flag
   `macro-connect` (PostHog, per the `feature-flags` skill) gates step 2's
   choice and step 3's flow.
6. **Granola sync** stays on Pipedream (`ApiProxy`): Granola's REST API takes
   API keys only.
7. Tests: dispatch picks the right backend per app and flag; Connect-backed
   upstream; connect-flow completion and disconnect against a fake
   `connect_client` server (`wiremock`); the migration default.

## Done when

- `cargo nextest run --all-features` for every changed Macro package passes.
- clippy (`-D warnings`), `cargo x deps --check`, `just check full` pass.
- Result: a local end-to-end run (Macro stack + `connect_api`): connect Linear
  from the web settings page with the flag on, then list its tools from chat.

## Out of scope

Deleting Pipedream code, migrating existing connections (reconnect prompts are
T011), Connect's deploy.

## Result
