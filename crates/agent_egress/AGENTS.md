# agent_egress

## What it is

Part of agent sessions: the security boundary for sandboxed coding agents.
A sandbox running model-authored code holds only a short-lived session
token; this crate resolves that token to the right upstream credential (an
MCP app, a custom server, or a GitHub installation token) on each request.

## Start here

- `src/lib.rs` doc comment: the full request flow (session token → grant →
  credential port → forward).
- `src/domain/service/actor.rs`: per-call requester/owner selection and cross-account approval policy.
- `src/outbound/actor_mcp.rs`: independent authenticated MCP sessions for tool listing/calls; credentials never share upstream session state.
- `src/domain/service.rs`: `EgressServiceImpl` — steps 2 and 3 (token → grant,
  grant → credential).
- `src/domain/ports.rs`: `SessionAuthority`, `McpCredentials`, `GithubTokens`,
  `Forwarder`.
- `src/outbound/mcp_credentials.rs` / `macro_mcp.rs` / `custom_mcp.rs` /
  `github_tokens.rs`: the credential resolvers.
- `src/inbound/axum_router.rs`: the HTTP entry point the sandbox calls.

## Scope

- Owns: resolving a session token to a scoped upstream credential and
  deciding whether a request is allowed; never names a destination itself.
- Not here: byte-shovelling the forwarded request — `src/outbound/forwarder.rs`
  is a thin port deliberately kept separate so the decision logic is testable
  without a socket.

## Boundaries

- Depends on: `agent_session` (session/owner lookup), `agent_runtime_protocol`.
- Used by: `agent_harness_service`, `preview_gateway`.

## Recipes

- Add a new upstream credential type: `src/domain/ports.rs` (new port) →
  `src/outbound/` (adapter) → `src/domain/service.rs` (dispatch) →
  `src/domain/approval.rs` if it needs owner approval.

Require `acting_as: requester | owner` on account-using session MCP calls;
resolve it before credentials, strip it before upstream dispatch, and ask for
approval only when the selected account differs from the verified requester.
Check turn authority through `TurnPrompter::acting_user()`: System turns never
inherit requester access, including malformed records retaining a user ID.
Keep discovery on the session owner's configured catalog. Requester-only
integrations are not advertised by this version. A missing selected connection
returns an actionable tool error; never fall back to another account.
Actor selection covers executable tool calls; initialization and other non-tool
MCP methods retain their existing owner proxy behavior. Git and preview egress
retain their existing session/repository identities.

## Checks

- `cargo test -p agent_egress` (`SQLX_OFFLINE` unset).

Code-mode minting attaches the session agent to a short-lived selected-user token;
ordinary MCP owner tokens omit agent attribution.

## Gotchas

- Never let the sandbox see an upstream credential directly; every egress
  path must go through a port here, not a bypass in the harness.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
