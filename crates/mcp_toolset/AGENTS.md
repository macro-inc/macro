# mcp_toolset

## What it is

Part of agent sessions / AI tooling. A shared `ai_toolset::ToolSet` adapter
over already-connected MCP server sessions: lists their tools, mangles
names, and routes calls back to the right server.

## Start here

- `src/lib.rs`: `client_info()` and the `McpServer` session type.
- `src/toolset.rs`: `RemoteMcpToolSet` — the `ToolSet` impl, `ConnectedServer`/`ListedServer`.
- `src/mangle.rs`: the `mcp__<server>__<tool>` name encoding/decoding;
  `unmangle` is the public split routing uses, also read by `agent_inmem`'s
  log replay.
- `src/call_tool_result.rs`: `CallToolResultExt` for converting MCP results.
- `src/combined.rs`: `CombinedToolSet`, static tools and MCP tools as one
  toolset, routed by `MANGLED_PREFIX`; chat and the in-process runtime use it.

## Scope

- Owns: tool listing, provider-safe name mangling, and call routing for any
  already-connected MCP server session.
- Not here: opening/authenticating MCP sessions — a user's connections are
  dialed by `connectors`; in-process ACP session wiring lives in `agent_inmem`.

## Boundaries

- Depends on: `ai_toolset`, `rmcp` (client feature), `genai_telemetry`
  (trace context in `_meta`).
- Used by: `agent_inmem`, `connectors`, `services/agent_harness_service`.

## Recipes

- Change how a tool name is mangled/recovered: `src/mangle.rs` →
  `src/mangle/test.rs`.
- Change how a tool call result is surfaced to the model: `src/call_tool_result.rs`
  → `src/call_tool_result/test.rs`.

## Checks

- `cargo test -p mcp_toolset` (`SQLX_OFFLINE` unset).

## Gotchas

- A mangled name's server segment does not identify its server: names are
  sanitized and truncated, so `macro_internal_` mangles like
  `macro_internal`. Decide anything by server with
  `RemoteMcpToolSet::server_of`, the name it was registered under.
- `dispatch_tool_call` races the call against `request_context.cancel`: the
  agent loop waits for running tools on cancel, and a server may hold a call
  (owner approval). Dropping the rmcp call sends `notifications/cancelled`.
- `ListedServer::trace_context`: `TraceContext::Propagate` puts the caller's
  W3C context in each call's `_meta` (SEP-414 keys); `agent_inmem` sets it
  only for the harness's own `macro_internal`. Every other server, and every
  `ConnectedServer`, gets `Withhold`: this toolset adds nothing to its
  requests (calls through the egress proxy get context from the proxy's own
  upstream exchange).

## Related

- Rules: `.agents/rules/rust/architecture.md`
