# mcp_client_label

## What it is

Agent posts made through the public Macro MCP: the label a post carries for the
MCP client that wrote it, its registered name plus an optional verified
`McpClientKind` that clients turn into a brand mark.

## Scope

- Owns: the `McpClientKind` wire values and the `McpClientLabel` pair.
- Not here: deciding a client's kind from its registration →
  `services/mcp_auth_proxy/src/domain/client_kind.rs`; drawing the mark →
  `apps/web/src/lib/core/component/mcpClientMark.ts`.

## Recipes

- Add a client: see `services/mcp_auth_proxy/AGENTS.md` Recipes, then
  regenerate the storage client and GraphQL SDL.

## Gotchas

- Kinds are stored by name in `comms_messages.triggered_via_kind`; never rename
  or remove a variant that rows may carry.
- Readers decode the kind strictly, so a new variant must be deployed to every
  reader before `mcp_auth_proxy` starts classifying clients as it.
