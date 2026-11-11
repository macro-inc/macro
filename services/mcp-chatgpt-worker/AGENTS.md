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
- `/mcp` builds a fresh MCP `Server` per request; `tools/call` picks the
  operation (`op` in `entity` grouping), and `runOperation` validates, calls
  the SDK and shapes the result. One `mcp_chatgpt.tool_call` span per call
  records tool, operation, hint and outcome.

## Start here

- `src/app.ts`: routes, auth challenge and the MCP handlers.
- `src/config.ts`: bindings, parsed with Zod; a missing value fails loudly.
- `wrangler.jsonc`: per-environment vars and custom domains.

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
- The SDK is imported by relative path from `packages/sdk/src`; SDK changes
  reach this Worker on its next deploy.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`, `.agents/rules/observability.md`
