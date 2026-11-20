# Macro's ChatGPT plugin

The package OpenAI's plugin directory takes (Agent Plugins 1.0.0): `plugin.json`
with the listing and review cases under `extensions.com.openai`, `mcp.json`
naming this Worker's `/mcp`, one onboarding skill, and the icons.

## Upload

```sh
cd services/mcp-chatgpt-worker/plugin && zip -r -X ../macro-plugin.zip plugin.json mcp.json skills assets
```

Upload the ZIP at platform.openai.com/plugins. Not in the package, entered in
the dashboard: the reviewer login (a password account
with sample data, no MFA or email codes).

## Rules

- The MCP URL can't change after submission. It must match `RESOURCE_URL` in
  `../wrangler.jsonc` (prod) and `McpChatgptServiceUrl` in
  `crates/macro_service_urls`.
- `tools_triggered` names real tools from
  `packages/sdk-mcp/src/__snapshots__/tools.entity.json`; renaming a tool
  there means updating the review cases here.
- Icons are Macro's black-and-white mark: `assets/logo.png` is
  `apps/marketing/public/logo.png` (macro.com/logo.png); `icon.png` and
  `icon-dark.png` are that mark in black and in white on transparent.
