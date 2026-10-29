# mcp_client

## What it is

Part of agent sessions / AI tooling. An MCP (Model Context Protocol) client
library: connects to user-configured MCP servers (including OAuth-protected
ones) and executes their tools for agents.

## How it works

A user connects a server through the HTTP routes, or an agent adds one with
the `ConnectMcpServer` AI tool and the user signs in afterwards (OAuth
callback if needed). Both paths go through `ServerDirectory`, which only lets
agents add public `https` destinations. The server config and OAuth tokens
are stored via the outbound adapters (Postgres, Redis). When an agent calls one of that server's tools, the
service orchestration layer looks up the connection and executes the tool
through `rmcp`, returning the result to the caller's tool-calling loop.

## Start here

- `src/domain/service/`: connection/tool-execution orchestration
  (`toolset.rs`, `server_access.rs`, `persisting_credential_store.rs`), and
  `server_directory.rs` for adding servers.
- `src/domain/ports.rs`: `McpServerStore`, `OAuthStateStore`, and the OAuth
  port the outbound adapters implement.
- `src/domain/provider_registry.rs` (feature `providers`): pre-registered
  OAuth credentials for known MCP providers, keyed off `macro_env_var`.
- `src/inbound/axum_router.rs`: HTTP routes for server management and the
  OAuth callback.
- `src/inbound/toolset.rs`: the `ConnectMcpServer` AI tool, wired through
  `ai_tools` where the MCP credentials key is configured.
- `src/outbound/`: `oauth.rs` (RMCP-backed OAuth), `pg_server_repo.rs`
  (Postgres server store), `redis_state_store.rs` (OAuth state).

## Scope

- Owns: storing a user's/team's configured MCP servers, OAuth connect/refresh
  flows for them, and invoking their tools through `rmcp`.
- Not here: the agent's tool-calling loop itself (`agent`, `ai_toolset`) —
  this crate is a tool *provider*, called by that loop.

## Boundaries

- Depends on: `agent`, `ai_toolset`, `macro_authorization` (feature `axum`),
  `macro_user_id`, `rmcp`.
- Used by: `agent_egress`, `agent_harness`, `ai_tools`, `mcp_select`,
  `onboarding`.

## Checks

- `cargo test -p mcp_client` (`SQLX_OFFLINE` unset).

## Gotchas

- MCP tool names reaching this crate from a provider can be mangled;
  `agent_harness_service::public_mcp` sanitizes them for provider matching — new
  provider integrations should go through the existing registry pattern, not
  a second ad hoc name-matching path.
- OAuth state lives in Redis (`redis_state_store.rs`) separately from the
  server config in Postgres (`pg_server_repo.rs`) — a server record surviving
  doesn't mean its OAuth state did.
- `ServerDirectory`'s public-destination check for agent-added servers judges
  hostnames by name and never resolves them, so a public name that resolves
  to a private address passes. Protection against that belongs where the
  backend connects, for every stored server.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
