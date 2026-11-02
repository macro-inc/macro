# T009: `connect_client`, the Rust client customers use

Depends on T005; T006 and T008 routes are added to the client when they merge
(re-dispatch with a Review section). Base on the integration branch.

## Goal

`connect_client` is the only Connect crate Macro may depend on: a typed async
client for the Connect API, and the single home of its wire types.

## Context

- Routes: T005 (connections, token export), T006 (connect sessions), T008
  (MCP gateway), T003 (catalog). Read their specs and the merged
  `connect_api` code; the OpenAPI document at `GET /openapi.json` is the
  contract.
- `.agents/rules/rust/libraries.md` CS-62 (one `reqwest::Client` with
  timeouts), CS-56 (`thiserror`), and `.agents/rules/observability.md`
  (inject `traceparent` on every outbound call; copy the injection helper
  into `connect_platform` if T003 didn't, since Connect can't use
  `macro_tower_layers`).

## Do

1. Move the request and response types of every customer-facing route into
   `connect/crates/connect_client/src/wire.rs` (serde + `utoipa::ToSchema`)
   and make `connect_api` use them, so the two cannot drift.
2. `ConnectClient::new(base_url, customer_key)` with methods:
   `catalog()`, `create_connect_session(external_user_id, app_id,
   redirect_url)`, `connections(external_user_id)`,
   `delete_connection(external_user_id, app_id)`,
   `access_token(external_user_id, app_id)`, and
   `mcp_upstream(external_user_id, app_id) -> McpUpstream { url, bearer_token }`
   (the gateway URL and the customer key, for an MCP client to dial; no
   network call).
3. Errors: one `thiserror` enum with caller-meaningful variants
   (`NotConnected`, `NeedsReauth`, `Unauthorized`, `Unavailable`, `Api {
   status, message }`, `Internal`).
4. A span per call (`connect.client.<method>`) with `app_id` and outcome;
   `traceparent` injected.
5. Tests with `wiremock` for every method, including error mapping; customer
   key never appears in `Debug` output.
6. `AGENTS.md` + `CLAUDE.md` symlink; say it is the public surface and that
   its API changes are breaking for customers.

## Done when

- `cargo nextest run --all-features -p connect_client -p connect_api` passes.
- clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.

## Out of scope

Macro code (T010), a TypeScript SDK.

## Result
