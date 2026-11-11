# MCP surfaces

Macro serves two MCP servers. Both run the same SDK as the signed-in user and
share one OAuth broker; they differ in how the SDK is exposed.

```
                        ┌──────────── mcp_auth_proxy (in agent_harness_service, McpPublicUrl) ───────────┐
MCP client ──OAuth────▶ │ /register /authorize /token   resource=…/mcp → which server the token is for   │
                        └──────┬──────────────────────────────────────────────┬──────────────────────────┘
                   FusionAuth token                                   Macro API token (kid=macro,
                               │                                        bot + agent_via=<client name>)
                               ▼                                              ▼
        McpPublicUrl/mcp: public MCP                     McpChatgptServiceUrl/mcp: services/mcp-chatgpt-worker
        code mode: ExecuteCode,                          SDK-generated tools (packages/sdk-mcp):
        DescribeCodeTools, ReadCodeDocs                  <entity>_read | _write | _delete, `op` union
                               │                                              │
                               └────────────── Macro service APIs ◀───────────┘
```

## Public MCP (harness)

`services/agent_harness_service/src/public_mcp*`. Code mode: programs run the
SDK in Deno. The harness looks up the access token's OAuth client and labels
writes "via <client>". Its protected-resource metadata advertises
`McpPublicUrl/mcp`; a token request without a `resource`, or with any value
other than the ChatGPT server's, gets the FusionAuth token as before.

## ChatGPT MCP server (Worker)

ChatGPT's directory review requires each operation as its own tool, so this
server exposes the SDK as generated tools instead of code mode:

- `packages/sdk-mcp` reads the SDK's types and TSDoc hint tags (`@readonly`,
  `@write`, `@destructive`) into one operation per public method, grouped per
  SDK entity and hint class, or one tool per operation (`TOOL_GROUPING`).
- The Worker is a resource server only. Its metadata names the broker; the
  broker answers `resource=<McpChatgptServiceUrl>/mcp` with a Macro API token
  minted for the Macro bot with `agent_via` set to the client's name, so
  Macro's APIs attribute writes without the harness in the path. The Worker
  passes the bearer unchanged to `new Macro({ token })`.
- Results are the SDK method's JSON-safe return value plus the entity's web
  URL; SDK errors become `invalid`, `not_found`, `forbidden`, `conflict` or
  `rate_limited` tool errors.

## Adding to either surface

Add an SDK method (`add-sdk-endpoint` skill) with its hint tag. Code mode picks
it up from the SDK docs; the Worker picks it up from the generator, and the
tool snapshots in `packages/sdk-mcp` show the change.
