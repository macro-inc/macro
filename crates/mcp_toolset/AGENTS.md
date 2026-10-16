# mcp_toolset

## What it is

Part of agent sessions / AI tooling. A shared `ai_toolset::ToolSet` adapter
over already-connected MCP server sessions: lists their tools, mangles
names, and routes calls back to the right server.

## Start here

- `src/lib.rs`: `client_info()` and the `McpServer` session type.
- `src/toolset.rs`: `RemoteMcpToolSet` — the `ToolSet` impl, `ConnectedServer`/`ListedServer`.
- `src/mangle.rs`: the `mcp__<server>__<tool>` name encoding/decoding.
- `src/call_tool_result.rs`: `CallToolResultExt` for converting MCP results.

## Scope

- Owns: tool listing, provider-safe name mangling, and call routing for any
  already-connected MCP server session.
- Not here: opening/authenticating MCP sessions — Pipedream's connection flow
  lives in `pipedream_mcp`; in-process ACP session wiring lives in `agent_inmem`.

## Boundaries

- Depends on: `ai_toolset`, `rmcp` (client feature).
- Used by: `agent_inmem`, `pipedream_mcp`.

## Recipes

- Change how a tool name is mangled/recovered: `src/mangle.rs` →
  `src/mangle/test.rs`.
- Change how a tool call result is surfaced to the model: `src/call_tool_result.rs`
  → `src/call_tool_result/test.rs`.

## Checks

- `cargo test -p mcp_toolset` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
