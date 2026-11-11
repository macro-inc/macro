# mcp_tool_name

## What it is

Part of agent sessions / AI tooling: the provider-safe name an MCP tool is
exposed under, `mcp__<server>__<tool>`. `Mangled::new` builds and sanitizes
it, `unmangle` splits it back for routing, and `MANGLED_PREFIX` tells MCP
tools apart from first-party ones.

## Boundaries

- Depends on: nothing.
- Used by: `mcp_client` and `mcp_toolset` (the two MCP toolsets),
  `mcp_select`, and `agent_inmem` (routing and log replay).

## Checks

- `cargo test -p mcp_tool_name`

## Gotchas

- Mangled names are persisted in agent session logs and matched by
  `agent_inmem`'s replay, so changing the encoding changes how old logs
  replay.
