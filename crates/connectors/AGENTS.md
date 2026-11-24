# connectors

## What it is

Part of agent sessions / AI tooling. Owns Macro's integrations: the apps and
MCP servers a user connects, which connection counts for each app, and how
chat, agents, the sandbox proxy, imports, Granola sync and the web reach them.
No other crate can name a source (native servers, the GitHub account link,
Pipedream, Macro Connect, the native API source) or tell which one holds a
connection.

## Start here

- `src/lib.rs`: the public surface. Everything else is private.
- `src/domain/service.rs`: the three service traits, the only way in, and
  `Connectors`, their one implementation: `McpConnectionsService` (a user's
  answer, tools for in-process agents, the sandbox proxy's upstream),
  `ApiConnectionsService` (an app's REST API through the counted connection),
  `ConnectionManagementService` (list, connect, add a server, enable, rename,
  remove).
- `src/domain/resolve.rs`: the pure function that applies the rules (which
  source counts per app and flag, disabled is not connected, one answer per
  app, `slack_v2` is `slack`, a native row is an app only at its overlay URL,
  API access from the counted connection, a failed flag read is off). Its
  tests are the rule table and the properties. Agent scope (rule 7) is
  `McpConnections::scoped`/`permit` in `domain/models.rs`;
  `permit_unconnected` permits an app in scope the user cannot use, which
  `upstream` addresses only where its counted source can reach any user
  (`Source::address_unconnected`: Pipedream, by user and slug), for the
  proxy to list its tools before they connect. A GitHub link that
  needs reauth (rule 8) is `outbound/github_link.rs`.
- `src/domain/policy.rs`: the only reader of the `macro-connect` flag, through
  one per-user cache. The string appears in no other Rust file (CI checks).
- `src/composition.rs`: `build`/`compose`, the only constructor of adapters.
  Call one once per process; the flag, overlay and Connect catalog caches
  live in what it returns. It re-exports the config types hosts fill in.
- `src/inbound/`: `axum_router.rs` (`/connectors`), `callbacks.rs` (the
  fixed-path routes vendors call: MCP OAuth callback and client metadata,
  the REST app OAuth callback `/connectors/apps/auth/callback`, Connect
  consent, Pipedream webhook), `toolset.rs` (`DiscoverConnectors`,
  `ConnectMcpServer`; `run` keeps refusals and outages apart for hosts that
  are not an agent loop).
- `src/outbound/`: one module per source, each one `Source`
  (`domain/ports.rs`): `native/`, `github_link.rs`, `pipedream/`,
  `macro_connect/`, `native_api/`; `hosted_connections.rs` is the table
  Pipedream and Connect share, each bound to its own `provider`.
- `src/outbound/native_api/`: REST apps Macro signs in to with its own OAuth
  client (Autodesk, `app.rs`; the list is `catalog::NATIVE_API_APPS`).
  `source.rs` is the `Source`, its `ApiConnection` and the callback's
  `AppAuthorization`; `oauth.rs` the token endpoint; `cipher.rs` the KMS
  envelope (CS-72); `repo.rs` `api_app_connections`; `pending.rs` the
  Redis sign-in state. Composed only with `ConnectorsConfig::autodesk`
  (`AUTODESK_CLIENT_ID`, `AUTODESK_CLIENT_SECRET`, `API_APP_GRANT_KMS_KEY_ID`,
  read by `ai_tools::connectors_config::autodesk_config`); without it
  Autodesk is not connectable. `app_directory::WithNativeApiApps` puts its
  apps at the head of the catalog.

## Boundaries

- Depends on: AWS KMS (`aws-sdk-kms`, native API grants), `connect_client`
  (the only Connect crate; a pinned copy, never
  edit it, not even its `AGENTS.md`, which still names `pipedream_mcp`; its
  one user is `connectors`, in `src/outbound/macro_connect/`),
  `mcp_toolset`, `ai_toolset`, `feature_flags`,
  `authentication_service_client`, `rmcp`.
- Used by: `agent_egress`, `agent_harness`, `agent_code_mode`, `ai_tools`,
  `import*`, `granola_sync`, `onboarding`, `services/agent_harness_service`,
  `services/document_storage_service`.

## Recipes

- Add a source: a module under `src/outbound/` implementing `Source` (and
  `McpConnection`/`ApiConnection` for what it provides), a `SourceKind`,
  its column in `resolve.rs`'s table with rule tests first, then
  `composition.rs`.
- Give consumers something new: a method on one of the three traits, served
  from `resolve`'s answer; never a new public path to a source.

## Checks

- `cargo test -p connectors --features test-fakes` and without the feature
  (`SQLX_OFFLINE` unset; the repository tests need local MacroDB).
- Consumers test against `fake::FakeConnectors` (feature `test-fakes`): the
  real services over in-memory sources, so a test can only hold states the
  rules produce. Never hand-write a fake store.
- The sources' vendor calls are covered end to end against dev by the nightly
  connectors suite, not by tests over hand-written JSON.

## Gotchas

- Every call to a user's server (transport, OAuth discovery, registration,
  refresh) goes through `McpHttp` in `outbound/guarded_http.rs`, which refuses
  non-public addresses on the address actually connected to. The egress
  proxy uses the same guard (`connectors::guarded_http`).
- `pipedream_mcp_connections` is keyed `(user_id, app_slug)` for both hosted
  providers: completing through one replaces and revokes the other's row.
  A `connect` row keeps Connect's app id in `account_id`.
- GitHub's `mcp_servers` row only stores the link's toggle and name; the
  native source skips it and the link source owns GitHub.
- OAuth state lives in Redis apart from the server row: a row surviving does
  not mean its sign-in did. The native API source keeps its own there
  (`connectors:api_app_sign_in:`), also ten minutes.
- A native API call reads the row, opens the envelope (one KMS `Decrypt`)
  and, within five minutes of expiry, refreshes under `SELECT ... FOR
  UPDATE`: the vendor rotates the refresh token on every refresh, so two
  replicas must never spend one. `invalid_grant` marks the row
  `needs_reauth` (a dead grant); any other token failure leaves it. A call
  may go only to the app's API origin (`ApiApp::api_url`), and follows no
  redirect.
- A native API app's callback stores the grant; `complete_connect` only
  finds the row, answering not found while it is missing or needs reauth so
  the web keeps polling.
- A server added by URL with no grant is connected (anonymous servers work);
  one whose row shows a dead grant (a sign-in that never finished, an expired
  token with no refresh token) needs reauth, as the proxy would refuse it.
  A refresh token the server revoked is found only when dialing.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
- Skills: `cloud-storage-hexagonal-architecture`
