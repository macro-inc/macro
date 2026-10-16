# mcp_service

## What it is

Lets external AI clients act as Macro agent sessions: a deployable service
exposing Macro's AI toolset (the same tools the agent chat/stream API uses)
as a Streamable HTTP MCP server, authenticated via OAuth 2.1 backed by
FusionAuth.

## Start here

- `src/main.rs`: composition root — builds `McpAuthProxyService`
  (from `mcp_auth_proxy`), the `rmcp` streamable HTTP transport, and
  `AuthenticatedToolService`.
- `src/tool_service.rs`: `ServerHandler` impl — extracts the authenticated
  user from request parts and maps `ai_toolset` tools/annotations onto the
  MCP wire format.
- `src/config.rs`: typed env vars (`macro_config`/`macro_env_var` pattern),
  including `DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS`.
- `src/markdown_images.rs`: resolves markdown image references in tool output.
- `src/tool_response.rs`: shapes tool results (incl. media) for MCP responses.

## Scope

- Owns: the MCP transport/handler layer and OAuth wiring around Macro's
  shared AI toolset.
- Not here: the OAuth broker logic itself → `mcp_auth_proxy` (mounted as a
  library, same binary); the tool implementations → `crates/ai_toolset`,
  `crates/ai_tools`.

## Boundaries

- Depends on: `mcp_auth_proxy` (OAuth broker), `ai_toolset`/`ai_tools`
  (the tool implementations), `fusionauth`, plus the domain crates each tool
  touches (`documents`, `databases`, `chat`, `crm`, `channels`, etc.).
- Used by: external/browser-based MCP clients (e.g. cursor.com) through the
  gateway; `MCP_ALLOWED_REDIRECT_HOSTS` controls which such clients are trusted.

## Recipes

- Add an MCP tool: implement it in `crates/ai_toolset` (shared with chat) →
  no changes usually needed here unless the tool needs MCP-specific response
  shaping → `src/tool_response.rs` / `src/markdown_images.rs`.
- Add a config value: `src/config.rs` → Doppler → the `mcp_service_doppler_config`
  binary validates it in CI.
- Allow a new MCP client origin: `src/config.rs`
  (`DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS`) — see `mcp_auth_proxy/README.md` for
  the redirect URI policy this feeds.

## Checks

- `cargo test -p mcp_service` (`SQLX_OFFLINE` unset).

## Related

- Skill: `create-ai-tool`, `new-service` · `services/mcp_auth_proxy/AGENTS.md`
