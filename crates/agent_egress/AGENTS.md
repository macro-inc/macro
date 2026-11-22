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
- `src/outbound/budgeted_mcp.rs`: wraps the actor transport. One in-memory
  lane per account and upstream (URL plus scope headers), shared by that
  account's sessions on this instance only, so each replica grants its own
  budget: 4 in flight, starts 100 ms apart, a lane-wide `Retry-After`
  cooldown (plus jitter) after a 429, and retries until no attempt may start
  after 25 s. It wraps only `tools/call` sends, so held approvals never take a
  permit and listings never queue. The sandbox proxy shares the lanes: a
  routine's burst can make the owner's interactive agent wait up to 25 s on
  the same app, by design, since they spend one quota.
- `src/domain/service.rs`: `EgressServiceImpl` — steps 2 and 3 (token → grant,
  grant → credential).
- `src/domain/ports.rs`: `SessionAuthority`, `McpCredentials`, `GithubTokens`,
  `Forwarder`.
- `src/outbound/mcp_credentials.rs` / `macro_mcp.rs` / `custom_mcp.rs` /
  `github_tokens.rs`: the credential resolvers.
- `src/inbound/axum_router.rs`: the HTTP entry point the sandbox calls.
- `SessionMcpExchange` (`src/domain/service/actor.rs`): in-process
  `tools/list`/`tools/call` on a connected app or custom server for a caller
  that authorized against the session itself (code executions'
  `macro.connectedApps`). It reads the grant by session id
  (`SessionAuthority::authorize_session`), never reaches Macro's own server or
  previews, and shares the actor path's credential resolution and
  not-connected answers. A call as the owner in a turn someone else prompted
  is held per call through `OwnerApprovals::hold_in_process`, the same
  approval record as the native tool gate. An upstream HTTP 429 on a
  `tools/call` is `EgressError::RateLimited` (with its `Retry-After`), which
  `exchange_as` returns as an error, never as an `isError` result (the
  sandbox proxy answers a tool result saying the call did not run).

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
A Program turn (a program or routine prompted it for the user) acts with that
user's access, so its calls are held or not exactly as the user's own turn's.
Keep discovery on the session owner's configured catalog. Requester-only
integrations are not advertised by this version. A missing selected connection
returns an actionable tool error; never fall back to another account.
Actor selection covers executable tool calls; initialization and other non-tool
MCP methods retain their existing owner proxy behavior. Git and preview egress
retain their existing session/repository identities.

## Checks

- `cargo test -p agent_egress` (`SQLX_OFFLINE` unset).

Session-egress Macro API tokens (`MacroApiTokens::mint`) carry the session's
bound agent (`agent_session.bot_id`, read off the row as `SessionGrant.agent`) as
their signed `agent_id` claim and retain `agent_session_id` provenance, so
code mode can mint a fresh invocation correlation. Cache credentials by owner,
agent, and session. The bot
never comes from the request. `MacroApiTokenSigner::mint_for_agent` callers
(code mode) choose the claim themselves, plus an optional signed `agent_via`
client label (public MCP code mode signs the MCP client's name) and a
`SignedCorrelation`: the code-mode correlation and its session's scope, signed
as `agent_scope` so services with no database enforce it too; `mint_for`
signs none of these claims. `mint_for_routine` signs the routine whose run the
token acts for (and optionally an agent; `None` writes as the owner, and a
scope, `dry_run` for a routine's dry run).
`mint_for_channel_mention` signs the channel message a bot's program answers
and the trusted origin channel (`channel_mention_channel_id`), with
`agent_scope = channel_mention`; services enforce that scope while retaining the
mention claim for attribution and the existing mention-specific refusals.

## Telemetry

- Every upstream MCP exchange, sandbox or in-process, is one
  `connected_app.mcp_exchange` client span (`traced_exchange` in
  `domain/service/actor.rs`): `server.address`, `app.kind` / `app.key` (the
  connected-app slug or custom-server key), `mcp.method`,
  `mcp.request_bytes` / `mcp.response_bytes` (JSON lengths) and `mcp.outcome`
  (`ok`, `tool_error`, `rate_limited`, `upstream_error`). Never arguments or
  results. A new upstream session's handshake is its own
  `connected_app.mcp_connect` child, and a `tools/call`'s pacing is its
  `mcp.call_budget` child (`wait_ms`, `attempts`, `rate_limited`).

## Gotchas

- Never let the sandbox see an upstream credential directly; every egress
  path must go through a port here, not a bypass in the harness.
- `ReqwestForwarder` and `HttpActorMcpTransport` build their clients from
  `mcp_client::outbound::guarded_http::client_builder` and check IP-literal
  URLs before sending: a custom server's URL is whatever its owner typed.
  Their `AddressPolicy` comes from the environment, so only a local stack
  reaches private addresses.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/architecture.md`
