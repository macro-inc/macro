# agent_harness_service

## What it is

The single deployed agent backend: sessions, chat/completions, public workspace
MCP, routine scheduling, and SSH/HTTP previews all run in this process. The
app-wide connection gateway remains a separate realtime service. Preview DNS,
HTTPS/SSH load balancers, and the projection queue have network/resource-only
Pulumi stacks; they do not host extra agent processes.

## Start here

- `src/main.rs`: composition root — builds Postgres repositories, the
  container manager, channel/session services, and wires
  `macro.channels`-derived triggers into `macro.agent_sessions`.
- `src/api.rs`: the full agent-session HTTP API (durable metadata/log reads
  plus live in-memory transport operations), composed from each domain
  crate's own router (`agent_session`, `agent_changes`, `agent_egress`,
  `agent_harness`).
- `src/model_providers/`: per-harness runtime adapters — `cursor.rs`,
  `macrod.rs`, `in_memory.rs`.
- `src/containers.rs`: Daytona sandbox lifecycle; local Docker opt-in.
- `src/trigger.rs`: turns channel/webhook triggers into sessions.
- `src/internal_mcp.rs`: the internal MCP server exposed to running sessions.
- `src/public_mcp.rs` + `src/public_mcp/`: public workspace MCP and OAuth;
  reuses the harness tool context and retains bearer authentication. Users with
  `ai-code-mode` get `ExecuteCode`/`DescribeCodeTools` in place of SDK-covered
  tools (`tool_service.rs`); the flag is cached per user (`tool_mode_cache.rs`).
  `src/public_mcp/analytics.rs` sends PostHog `$mcp_initialize` /
  `$mcp_tool_call` events (PostHog MCP analytics schema) in the background,
  with the user's team as the `team` group. At most 64 sends run at once
  (more are dropped) and each user's team is cached for 10 minutes.
- `src/cognition/`: existing chat, completions, integrations, and projection
  workers; the library also exports their OpenAPI document.
  `src/cognition/service/integration_analytics.rs` sends PostHog
  `integration_connected` / `integration_disconnected` for native MCP servers
  and Pipedream apps, from the router hooks wired in `src/cognition/server.rs`.
- `src/scheduling.rs`: routine HTTP routes and background scheduling;
  domain/adapters live in `crates/scheduled_action`.
- `src/preview.rs` + `src/preview/`: preview control routes, public HTTP and SSH listeners;
  lease/ticket and authorization logic lives in `crates/agent_preview`. The shared
  pool stores replica ownership and credential hashes; startup and ten-second
  heartbeats register this process's private HTTP address for direct forwarding.
- [Consolidation guide](../../docs/guides/consolidate-agent-services.md):
  Doppler migration, retirement order, OAuth provider cutover.

## Scope

- Owns: the deployed process wiring every agent-session domain crate
  together — not the domain logic itself, which lives in `crates/agent_harness`,
  `crates/agent_session`, `crates/agent_changes`, `crates/agent_egress`,
  `crates/folds/agent_fold`, `crates/agent_inmem`, `crates/agent_trigger`.
- Not here: coding-agent business logic for a specific runtime (e.g. Cursor
  API calls) → `crates/codex_connection`, `crates/codex_cloud_agents`.

## Recipes

- Add a new agent-session route: the owning domain crate's `inbound::axum_router`
  → mount it in `src/api.rs`.
- Add a new model/runtime provider: `src/model_providers/<provider>.rs` →
  `src/model_providers/mod.rs` → wire into `src/main.rs`.
- Inspect a session's protocol log: `just session-log <channel_id>`.

## Tool contracts

- Internal session tools require a verified acting user plus owner/edit authorization. Keep their restricted prompt/stop route separate from human approval controls.

The composition root wires `PgExternalReplyStore` into the harness and recovers
unfinished external chat replies alongside conversation recovery every ten seconds.
Both the backend and macrod's source-message action IDs are required for replies
from newly triggered external chat turns to finish in their channel threads.

The cancellable, tracked notification worker calls `recover_notifications`
every two seconds. It routes delivery and acknowledgments through each
session's serialized worker. Internal producers use
`POST /agent-sessions/internal/notifications`; only internal credentials may
produce events, independently of public session control.

## Checks

- `cargo test -p agent_harness_service` (`SQLX_OFFLINE` unset).
- `just check` (`SQLX_OFFLINE=true cargo check`).
- `just run-local` — needs `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`,
  `GITHUB_TOKEN` in the environment or a local `.env`.

Code-mode credentials sign the authenticated session bot identity for SDK
message attribution after owner approval, while retaining user authentication.

## Configuration and lifecycle

All feature configs read the same harness `APP_SECRETS_JSON`; the harness
Doppler validation binary validates each config. Stable public origins resolve
once at startup through `macro_service_urls`: `McpPublicUrl` preserves the
`mcp-server[-dev].macro.com` OAuth identity, `CognitionPublicUrl` preserves
`document-cognition[-dev].macro.com` integration callbacks, and `AppServiceUrl`
supplies browser links and preview form origin. Preview control accepts the
`PreviewGatewayUrl` host (plus app/loopback hosts locally). Use process-level
`OVERRIDE_*` values for local instances. The shared gateway preserves the public
hostnames and internally rewrites cognition paths. `PREVIEW_DOMAIN` and
`PREVIEW_SSH_HOST` remain infrastructure-generated Doppler settings. Legacy
`MCP_PUBLIC_URL`, `MCP_CLIENT_PUBLIC_URL`, `PREVIEW_APP_ORIGIN`, and
`PREVIEW_CONTROL_HOSTS` values are retained only for old-image rollback; new
code does not read them. `POSTHOG_API_KEY` and `POSTHOG_HOST` drive
feature flags and the MCP and integration analytics; when the key is unset,
analytics are off.
In deployed configs, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY`
is cognition's Secrets Manager reference; AI tools resolve the separate
`DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME` reference.

The shared Postgres pool defaults to 30 connections (`DATABASE_MAX_CONNECTIONS`).
Routine dispatch waits for the shared HTTP listener and calls its loopback
address, avoiding an ALB/self-startup race. Shutdown stops scheduling intake and
projection workers before draining sessions and pending publishes. Preview
listener failure shuts down the process so ECS can replace the task.

## Gotchas

- Keep two tasks and rolling replacements in both environments. Preview
  control uses shared Postgres state. SSH claims a tunnel owner; browser HTTP/WS
  forwards directly to that owner. Keep preview security-group self-ingress on
  TCP 8111 so peers can connect; live SSH handles remain local to each process.
- Two managed bots run on different runtimes: `@coder` (`HARNESS_BOT_ID`) in a
  Daytona sandbox, `@macro-new`/`@macro` (`INMEM_BOT_ID`) on the in-process ACP
  runtime — check which one a bug report is about before debugging containers.

- Analytics record the tool name, outcome, duration, and client headers only;
  never add tool arguments or results to them.
- The public MCP server is stateless, so tool calls carry no `clientInfo`; the
  client is identified per call by its `User-Agent` / `x-anthropic-client`
  headers and per session by `$mcp_initialize`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/config-and-service-urls.md`
