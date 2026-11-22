# connectors

Status: migrating to one hexagonal crate whose only way in is the service
traits in `src/domain/service.rs`; until then the source modules below are
public so their old consumers compile.

## What it is

Part of agent sessions / AI tooling. Owns Macro's integrations: the MCP
servers and apps a user connects, and how agents and imports reach them.
Each source of connections lives under `src/outbound/`:

- `native/` (was `mcp_client`): user-configured MCP servers, including
  OAuth-protected ones, dialed in process through `rmcp`.
- `pipedream/` (was `pipedream_mcp`): apps connected through Pipedream
  Connect, called through Pipedream's remote MCP server. `source.rs` is
  Pipedream as a domain `Source`; the rest is the old ports and routes its
  hosts still use, including the Pipedream-or-Connect chooser
  (`outbound/dispatch.rs`), a shim deleted with its last host.
- `macro_connect/`: Macro Connect (`connect_client`) as a `Source`.
- `hosted_connections.rs`: the `pipedream_mcp_connections` table both hosted
  sources share, each through a `HostedRepo` bound to its own `provider`.
- `overlays.rs`: the `mcp_overlays` table as the domain's `OverlayCatalog`.

The crate root (was `mcp_select`) decides per user which stack serves an app
and composes both into one toolset (`McpToolSelector`, `UserMcpTools`).

## Start here

- `src/domain/service.rs`: the three service traits and `Connectors`, their
  one implementation over every `Source`, the flag and the overlay table; it
  asks `resolve.rs` for every answer. `src/domain/policy.rs` is the only
  reader of the `macro-connect` flag (one per-user cache; a failed read is
  off). Tool loading answers without a source whose store is down; listing
  and API lookups fail instead.
- `src/fake.rs` (feature `test-fakes`): `FakeConnectors`, the real services
  over in-memory sources, for consumers' tests. Use it instead of a
  hand-written fake store.
- `src/lib.rs`, `src/selection.rs`, `src/overlay.rs`: the per-provider
  selection, the seven-app list, and overlay status over the native store.
- `src/outbound/native/domain/service/`: tool execution (`toolset.rs`,
  `server_access.rs`, `persisting_credential_store.rs`), adding servers
  (`server_directory.rs`), and `linked_github.rs`: `WithLinkedGithub`, which
  answers GitHub's server with the user's GitHub account link token. Hosts
  read the native store as `outbound::native::outbound::NativeServerStore`.
- `src/outbound/native/source.rs`: `NativeSource`, the native rows behind
  the `Source` port (every row is its `ServerUrl`; GitHub's row is skipped),
  and `src/outbound/github_link.rs`: `GithubLinkSource`, GitHub as
  `App(github)` from the account link (a refused token is held but not
  authorized; removing it unlinks the account; its toggle stays in the
  `mcp_servers` row at GitHub's address). Sources put a `SourceRefusal` in
  their report so the service can answer with a typed error.
- `src/outbound/native/domain/provider_registry.rs` (feature `providers`):
  pre-registered OAuth credentials for known MCP providers.
- `src/outbound/pipedream/outbound/api.rs`: the Pipedream HTTP client and the
  Connect API proxy (`ConnectedAppProxy`) that calls an app's own REST API;
  `HIDDEN_APP_SLUGS` are never offered.
- `src/outbound/pipedream/outbound/pg_connection_repo.rs`: the
  `pipedream_mcp_connections` and `mcp_overlays` tables. Connection reads skip
  overlaid slugs, and completing a Pipedream connection to one refuses it (409)
  and deletes the new Pipedream account.
- `src/outbound/pipedream/outbound/connect.rs`: the old ports over
  `macro_connect`'s client; `dispatch.rs`: `ConnectorBackends`, which holds
  the host's `ConnectRollout` (the `macro-connect` flag, read by
  `ai_tools::macro_connect_rollout` until its consumers move onto the
  services).

## Boundaries

- Depends on: `ai_toolset`, `mcp_toolset`, `authentication_service_client`,
  `connect_client` (the only Connect crate Macro may use), `feature_flags`,
  `macro_authorization` (feature `axum`), `macro_user_id`, `rmcp`.
- Used by: `agent_egress`, `agent_harness`, `agent_inmem`, `agent_code_mode`,
  `ai_tools`, `import*`, `granola_sync`, `onboarding`,
  `services/agent_harness_service`, `services/document_storage_service`.

## Checks

- `cargo test -p connectors` (`SQLX_OFFLINE` unset; requires local MacroDB).
- `cargo clippy -p connectors --features test-fakes` as well as without it.

## Gotchas

- Every connection to a user's server (transport, OAuth discovery,
  registration, token refresh) goes through `McpHttp`
  (`native/outbound/guarded_http.rs`), which refuses non-public addresses on
  the address actually connected to. Build it once per composition root from
  `AddressPolicy::for_environment`. Never dial a stored server with
  `reqwest::Client::new()`, `StreamableHttpClientTransport::from_uri`, or
  `AuthorizationManager::new`.
- OAuth state lives in Redis, apart from the server row in Postgres: a row
  surviving doesn't mean its OAuth state did.
- A `provider = connect` row stores Connect's app id in `account_id` and keeps
  the Pipedream slug in `app_slug`. Granola sync reads Granola's REST API, so
  it only syncs Pipedream-held Granola accounts.
- Completing a connection turns the app on, even over a row the user disabled.
- The old `PgConnectionRepo` hides Pipedream rows of overlaid apps; the
  hosted sources do not, since the resolver decides which source counts.
- `pipedream_mcp_connections` is keyed `(user_id, app_slug)` for both
  providers: completing an app through one provider replaces the other's row
  under any of the app's slugs and revokes the replaced grant
  (`HostedRepo::replace`, `revoke_replaced`).
- `github` is overlaid, but its native server is authorized by the GitHub
  account link, not MCP OAuth.
- The Connect consent redirect (`/pipedream/mcp/connect/callback`) is public
  and records nothing; `/pipedream/mcp/connect/complete` trusts only Connect's
  own connection list.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
- Plan: section 3 of the integrations-in-one-crate plan (crate layout).
