# mcp-chatgpt-worker

## What it is

The MCP server ChatGPT connects to: a Cloudflare Worker serving the tools
`packages/sdk-mcp` generates from the SDK over stateless Streamable HTTP at
`/mcp`. Each call runs the SDK as the bearer token's user, so the backend's
own permission checks and agent attribution apply.

## How it works

- `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728) names this
  resource and its authorization server, the MCP OAuth broker
  (`services/mcp_auth_proxy`, mounted in the harness at `McpPublicUrl`).
  A request without a bearer gets a 401 pointing there.
- `/.well-known/openai-apps-challenge` returns the `OPENAI_APPS_CHALLENGE`
  secret, which OpenAI's app dashboard checks to verify the domain before an
  app submission (`bunx wrangler secret put OPENAI_APPS_CHALLENGE --env <env>`).
- `/mcp` builds a fresh MCP `Server` per request; `tools/call` picks the
  operation (`op` in `entity` grouping), and `runOperation` validates, calls
  the SDK and shapes the result. One `mcp_chatgpt.tool_call` span per call
  records tool, operation, hint and outcome.

## Start here

- `src/app.ts`: routes, auth challenge and the MCP handlers.
- `src/config.ts`: bindings, parsed with Zod; a missing value fails loudly.
- `wrangler.jsonc`: per-environment vars and hosts (dev and prod on workers.dev).

## Checks

- `bun run type-check`, `bun run test` (both generate the SDK tool catalog
  first; needs `bun install --frozen-lockfile` in `packages/sdk`).
- `bunx wrangler deploy --dry-run --env dev --outdir <dir>` bundles without
  deploying.

## Gotchas

- `TOOL_GROUPING` switches between entity tools and one tool per operation;
  both lists are snapshotted in `packages/sdk-mcp`.
- `RESOURCE_URL` and `AUTHORIZATION_SERVER_URL` mirror
  `McpChatgptServiceUrl` and `McpPublicUrl` in `crates/macro_service_urls`;
  change all of them together. Service hosts come from the SDK for
  `MACRO_ENV`; `MACRO_HOSTS` (JSON) only points a local run at a named stack.
- Deploys are `workflow_dispatch` only (`Deploy MCP ChatGPT Worker`).
- OpenAI submits the app as a plugin ZIP of `openai-plugin/` (Agent Plugins
  `plugin.json` with listing and review cases, `mcp.json` with the prod
  `RESOURCE_URL`, `assets/`). Build it with
  `cd openai-plugin && python3 -m zipfile -c ../macro-openai-plugin.zip plugin.json mcp.json assets`;
  never commit the ZIP. The demo video URL and reviewer account go in the
  dashboard. `chatgpt-app-submission.json` (OpenAI's `chatgpt-app-submission`
  skill format) holds each tool's hint justifications for the form; its
  `tools` copy the `entity` snapshot's hints. Refresh both when that snapshot
  or the prod `RESOURCE_URL` changes.
- The SDK is imported by relative path from `packages/sdk/src`; SDK changes
  reach this Worker on its next deploy.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`, `.agents/rules/observability.md`
