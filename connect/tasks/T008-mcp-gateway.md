# T008: MCP gateway

Depends on T006 (refresh path). Base on the integration branch after T006
merges.

## Goal

A customer's agent talks MCP to any connected app through Connect, which
attaches the user's vendor token, so customers never handle vendor tokens to
use tools (export stays available for those who want it).

## Context

- MCP Streamable HTTP transport: POST JSON-RPC, responses as JSON or SSE,
  `GET` for a server stream, `DELETE` to end a session, `Mcp-Session-Id`
  header.
- T005/T006: customer auth, connections, refresh, `needs_reauth`.
- `.agents/rules/observability.md`.

## Do

1. Route `/v1/users/{external_user_id}/mcp/{app_id}` (customer auth), all of
   `POST`, `GET`, `DELETE`: a streaming reverse proxy to the app's `mcp_url`.
   Forward the body, `Accept`, `Content-Type`, `Mcp-Session-Id`, and
   `MCP-Protocol-Version`; set `Authorization: Bearer <vendor access token>`
   from the refresh path; stream the response (JSON or SSE) back without
   buffering; copy `Mcp-Session-Id` back. Do not parse or rewrite MCP
   messages beyond reading the JSON-RPC `method` for the span.
2. Vendor `401`: refresh once and retry the request if the body allows (POST
   bodies are buffered up to 1 MiB for the retry; larger bodies are not
   retried); a second `401` marks the connection `needs_reauth` and returns
   `409` with `{"error":"needs_reauth","app_id":...}`.
3. Unknown app, no connection, or `needs_reauth`: `404` / `409` with a JSON
   error naming the app.
4. One shared `reqwest::Client` with connect and read timeouts suited to
   streams (no total timeout on SSE).
5. Span `connect.mcp.proxy`: `customer_id`, `app_id`, JSON-RPC `method`
   (POST only), vendor status, refresh-and-retry outcome, bytes, and
   time-to-first-byte from the vendor. Never bodies or tokens.
6. Tests with a `wiremock` MCP server: JSON response, SSE stream passes
   through incrementally, session header round-trip, 401 → refresh → retry
   success, 401 twice → `needs_reauth`, missing connection, customer
   isolation.

## Done when

- `cargo nextest run --all-features -p connect_api` passes.
- clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.
- Result: a real `tools/list` through the gateway against an app connected
  locally in T006 (paste the tool count), or why it was not possible.

## Out of scope

Tool-name rewriting, caching, rate limiting, Macro's adapter.

## Result

Implemented the customer-authenticated MCP gateway in
`connect/services/connect_api/src/mcp.rs` and wired it from `src/main.rs`.
It forwards POST, GET, and DELETE with the MCP headers and vendor bearer token,
streams vendor responses, and retries a vendor 401 after a forced grant refresh
when the request body is at most 1 MiB. A second 401 marks the connection
`needs_reauth`. The OAuth domain service's live-app and refresh policy is in
`src/domain/oauth.rs`; `src/outbound.rs` and `src/outbound/mcp.rs` own the shared
vendor HTTP client and outbound trace span. `src/main.rs` also publishes all
three methods in OpenAPI. `src/mcp/test.rs`, `src/oauth_test.rs`, and
`src/test.rs` cover the gateway and update test fixtures. `Cargo.toml` and
`Cargo.lock` record the streaming dependencies;
`connect/services/connect_api/AGENTS.md` documents the route and retry behavior.

Checks (all Rust and repo commands ran inside `nix develop`, with
`CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"` and
`DATABASE_URL="$CONNECT_DATABASE_URL"`):

- `cargo nextest run --all-features -p connect_api`: passed, 18 tests.
  Wiremock covers JSON, SSE, session headers, 401 refresh and retry, a second
  401, oversized POST, missing app/connection, and customer isolation. A
  controlled streaming server test verifies the first SSE event arrives before
  the vendor finishes its response.
- `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`:
  passed.
- `cargo x deps --check`: passed.
- `just check`: passed.
- Rust validation: `just rust-check`, `just clippy`, `just format`, and
  `just hakari` passed in that order; `cargo fmt --all -- --check` passed.
- `git diff --check`: passed. The post-change audit passed the hexagonal
  boundary, OpenAPI, trace propagation, and documentation review.
- Real `tools/list` through a T006 local connection: unavailable, so no tool
  count. The configured local Connect database has no `connections` table
  (`psql "$DATABASE_URL" -tAc "SELECT count(*) FROM connections"` returned
  `relation "connections" does not exist`), and T006 has not completed a live
  vendor connection. A connected trace in Tempo was consequently not verified.

Open questions: none.

Proposed commit:

```text
feat(connect): proxy MCP requests with customer-scoped vendor grants

Customers need an MCP endpoint that keeps vendor grants inside Connect and
survives expired or rejected access tokens.

Add the streaming gateway, bounded POST replay, one refresh retry, and
reauthorization state on a second 401. Cover transport, retry, and customer
isolation with gateway tests and document the route.
```
