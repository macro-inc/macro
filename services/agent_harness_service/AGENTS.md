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
- `src/pull_request_archive.rs`: consumes `macro.github_pull_requests` (group
  `agent-harness-pull-request-archive`) and auto-archives sessions whose
  linked pull requests finished (`agent_session::domain::auto_archive`).
- `src/internal_mcp.rs`: the internal MCP server exposed to running sessions.
- `src/anthropic_gateway.rs` + `src/anthropic_gateway/`: `/anthropic/v1/messages`
  and `/anthropic/v1/messages/count_tokens` on the egress listener, for runtimes
  on Macro credits (Claude Code on a Macro computer). Both values come from
  the `macro_internal` MCP server in `session/new`/`load`/`resume`:
  `ANTHROPIC_BASE_URL` is its URL with `/mcp/internal` replaced by
  `/anthropic`, and `ANTHROPIC_AUTH_TOKEN` is the session egress token from
  its `Authorization: Bearer` header (re-minted on every attach, so restart
  the runtime with the latest one). Requests pass through unchanged with
  `ANTHROPIC_API_KEY`; only `anthropic-version`/`anthropic-beta` are
  forwarded. Models are a const allowlist (`ALLOWED_MODELS`, each mapped to
  its `ai_pricing` id, including the image’s bundled Claude Code Opus 4.8 and Sonnet 4.6
  defaults). `messages` is admitted as `AiFeature::AgentSession`
  for the session owner, and its `usage` (SSE `message_start`/`message_delta`
  or the JSON body) goes to the process's settling recorder, which charges
  only under `ENABLE_AI_USAGE_BILLING`. Span: `anthropic_gateway.messages`.
- `src/computers.rs`: configures the optional fleet operator, runs fleet effects,
  timers, reconciliation and idle sleep, reports macrod presence, and wakes
  sleeping computers before forwarding prompts. `COMPUTERS_FLEET` selects
  `incus` or local-only `docker`; unset disables the control plane.
- `src/computer_screen.rs` + `src/computer_screen/`: Macro computer routes.
  `POST /harnesses/{id}/claude-sign-in` → `{url}`,
  `POST /harnesses/{id}/claude-sign-in/complete` `{code}` → `{signedIn}`,
  `POST /harnesses/{id}/claude-sign-out` → `{mode}` (manage rights; mode is
  written to the harness row on macrod's confirmation; a shared 180-second
  account-change lease covers the command and mode write, preventing opposing
  requests from persisting out of order; concurrent requests get 409),
  `GET /harnesses/{id}/claude-mode` → `{mode}` (manage rights), and two
  websockets: the viewer's `GET /harnesses/{id}/screen[?control=true]` (view
  rights; `control` needs manage, else `rfb.rs` drops input messages and
  fails closed on anything unreadable) and macrod's
  `GET /harnesses/me/screen?stream=` (harness token). Commands reach
  macrod as `computerControl` runtime messages; `bus.rs` carries them over
  Redis (`agent-harness.computer-control`: claim with `SET NX`, ack within
  3 s or 409, then the answer) when the runtime is on another replica, and
  always carries screen bytes over per-stream channels, so either socket may
  land on any replica. Each screen socket sends a ping every 20 seconds so a
  static desktop stays connected through the load balancer. Both sides require
  initial peer RFB bytes within 20 seconds, cleaning up cancelled upgrades.
  Spans:
  `computer_control.request`/`.execute`,
  `computer_screen.view`/`.computer` (joined by `stream_id` and propagated
  context).
- `src/public_mcp.rs` + `src/public_mcp/`: public workspace MCP and OAuth;
  reuses the harness tool context and retains bearer authentication. Users with
  `ai-code-mode` get only `ExecuteCode`/`DescribeCodeTools`/`ReadCodeDocs` on
  `tools/list` (`tool_service.rs`); hidden native tools stay callable. The flag
  is cached per user (`tool_mode_cache.rs`).
  Code execution's destination list in `src/code_mode.rs` also includes the
  configured editing worker, whose comment-mark endpoint requires a scoped
  document token; this does not grant permission to edit document content.
  `src/public_mcp/analytics.rs` sends PostHog `$mcp_initialize` /
  `$mcp_tool_call` events (PostHog MCP analytics schema) in the background,
  with the user's team as the `team` group. At most 64 sends run at once
  (more are dropped) and each user's team is cached for 10 minutes.
- `src/cognition/`: existing chat, completions, integrations, and projection
  workers; the library also exports their OpenAPI document.
  `src/cognition/service/integration_analytics.rs` sends PostHog
  `integration_connected` / `integration_disconnected` for native MCP servers
  and Pipedream apps, from the router hooks wired in `src/cognition/server.rs`.
- `crates/web_search` owns `POST /web/search` and `/web/fetch` (mounted in
  `src/cognition/api.rs`, rate limited per user through cognition's Redis) and the
  `WebSearch`/`WebFetch` tools; `TAVILY_API_KEY` comes from Doppler `shared_ai`.
- `crates/universal_input` owns Command K's authenticated `/universal_input/classify`
  and `/universal_input/extract` routes, mounted directly by `src/api.rs`. The root
  composes staged search type/field extraction and Clairic content extraction
  with Nemotron temporal extraction and the shared admission/usage services.
  It also mounts the internal `/universal_input/thread-due-date` route, which reads
  a thread's due date for `email_focus_worker` and meters it as `EmailFocus`.
- `src/scheduling.rs`: routine HTTP routes and background scheduling;
  domain/adapters live in `crates/scheduled_action`. Its run observers send
  `routine_run_finished` analytics and, for every run, an inbox-only
  `routine_run_finished` notification to the owner
  (`src/scheduling/routine_run_notifications.rs`).
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

- Internal session tools require explicit `acting_as`, resolved by the shared gate, plus existing owner/edit authorization. SDK executions choose one account for the whole program; review decisions use the saved acting account. Keep their restricted prompt/stop route separate from human approval controls.
- An import review's draft is `{source, excluded, shared, personal}` (`source` is `notion`, `linear`, or `jira`): the rows the owner left out and the rows whose sharing they flipped, passed to `start_workspace_write` as `NotionWriteChoices`.
- One `ai_tools::ImportJobs` serves the whole process: session tools, public MCP, and `cognition::build` (the `/import/*` routes and the only stalled workspace-import sweeper, which adopts Notion, Linear and Jira runs) share it, and `main.rs` hands running imports over on shutdown (`ImportJobs::hand_over`).
- The import service registers read-only Notion, Linear and Jira Pipedream readers wherever it is built (`cognition/server.rs` and `ai_tools::build_context`, which public MCP reuses). Authenticated `/import/workspaces/{source}` report and `/cancel` routes serve the shared review card; `/import/notion` remains for existing clients. Workspace tools stage reviewed plans; they never write upstream.
- The agent approves a presented review after its account holder says yes in chat by submitting it with `DecideReview`: `Actions::session` reports the turn's prompter from `agent_session.turn_prompter`, and `approvable` refuses an import whose plan is not `ready` for that review.
- Presenting an import review ties its plan to the review and the session (`attach_workspace_review`); the import then produces `import.planned` and `review.settled` for that session itself, in the run's transaction (`crates/import`).
- The owner connecting an app a session asked for produces an `app.connected` event (`agent_harness::domain::app_connections`).

The composition root wires `PgExternalReplyStore` into the harness and recovers
unfinished external chat replies alongside conversation recovery every ten seconds.
Both the backend and macrod's source-message action IDs are required for replies
from newly triggered external chat turns to finish in their channel threads.

The cancellable, tracked notification worker calls `recover_notifications`
every two seconds. It routes delivery and acknowledgments through each
session's serialized worker. Internal producers use
`POST /agent-sessions/internal/notifications`; only internal credentials may
produce events, independently of public session control.

## Canvas media

- `RenderCanvas` promotes only its explicit top-level `modelMedia` contract to at most two bounded native PNG blocks; pixels are removed from text and structured JSON, nested scene media is never promoted, and this adapter never fetches image URLs.

## Checks

- `cargo test -p agent_harness_service` (`SQLX_OFFLINE` unset).
- `just check` (`SQLX_OFFLINE=true cargo check`).
- `just run-local` — needs `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`,
  `GITHUB_TOKEN` in the environment or a local `.env`.

Code-mode credentials sign the session bot for SDK attribution and the selected
user for API authorization; owner approval is required only for cross-account
access. Lifecycle, runtime provider connections, billing, and memory stay owner-scoped.

## Configuration and lifecycle

Computer fleets require `COMPUTERS_CONTROL_PLANE_ID` whenever `COMPUTERS_FLEET`
is set. Read the stable identity from Doppler in deployed environments; local
stacks explicitly set `local-<instance>`. Distinct control planes sharing a host
must use distinct identities; replicas of one control plane share an identity.

An enabled fleet also requires `COMPUTERS_IMAGE`, `COMPUTERS_HOST_NAME`,
`COMPUTERS_HOST_RESERVE_GB`, and `COMPUTERS_OVERSELL_FACTOR`. Docker additionally
requires `COMPUTERS_DOCKER_MEMORY_GB`, network and enrollment directory. Incus
requires its endpoint and mTLS material, `COMPUTERS_INCUS_PROFILE`,
`COMPUTERS_INCUS_STORAGE_POOL`, `COMPUTERS_INCUS_REQUEST_TIMEOUT_SECS`,
`COMPUTERS_INCUS_CONNECT_TIMEOUT_SECS`, `COMPUTERS_INCUS_OPERATION_WAIT_SECS`,
`COMPUTERS_INCUS_OPERATION_WAITS`, `COMPUTERS_INCUS_STATE_CHANGE_TIMEOUT_SECS`,
and `COMPUTERS_INCUS_SHUTDOWN_GRACE_SECS`. Missing values fail startup with the
variable name; fleet-specific values are required only for that fleet.
Local orchestration supplies every value explicitly for each fleet; see
[required variables and local values](../../docs/development/running-locally.md#macro-computers).

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
analytics are off and routine template publishing, reads, and activation are
disabled. Scheduling wires the per-user `enable-routine-sharing` PostHog gate;
owner unsharing and already activated routines remain available.
In deployed configs, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY`
is cognition's Secrets Manager reference; AI tools resolve the separate
`DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME` reference.

The shared Postgres pool defaults to 30 connections (`DATABASE_MAX_CONNECTIONS`).
Routine dispatch waits for the shared HTTP listener and calls its loopback
address, avoiding an ALB/self-startup race. Shutdown stops scheduling intake and
projection workers before draining sessions and pending publishes. Preview
listener failure shuts down the process so ECS can replace the task.

## Gotchas

- Keep computer domain IDs, harness IDs, and Incus resource names typed in `computers.rs`; unwrap only when calling the existing harness registry or SQL boundary.

- Keep two tasks and rolling replacements in both environments. Preview
  control uses shared Postgres state. SSH claims a tunnel owner; browser HTTP/WS
  forwards directly to that owner. Keep preview security-group self-ingress on
  TCP 8111 so peers can connect; live SSH handles remain local to each process.
- Two managed bots run on different runtimes: `@coder` (`HARNESS_BOT_ID`) in a
  Daytona sandbox, `@macro-new`/`@macro` (`INMEM_BOT_ID`) on the in-process ACP
  runtime — check which one a bug report is about before debugging containers.

- Analytics record the tool name, outcome, duration, and client headers only;
  never add tool arguments or results to them.
- Public MCP tool calls run for the `ToolCaller` the bearer middleware
  (`mcp_auth_proxy`) attached, and a call without one is refused: `Agent` (a
  Macro API token's signed `agent_id`, which egress mints from the session's
  `agent_session.bot_id`) writes as that agent, under the bot's own name (read
  per call, so its document edits label their live cursors with it);
  `McpClient` (OAuth) writes as the Macro bot labelled with the client's name
  (shown as the author); `ApiKey` writes as the Macro bot. Public `ExecuteCode`
  builds its context per call from the caller and signs the same attribution
  into its SDK token: the agent, or the Macro bot plus the client name as
  `agent_via`. Never read a bot id or client name from the request itself.
- The public MCP server is stateless, so tool calls carry no `clientInfo`; the
  client is identified per call by its `User-Agent` / `x-anthropic-client`
  headers and per session by `$mcp_initialize`.

Local MCP uses both configured egress addresses in the in-process catalog;
the public MCP transport permits its typed service hostname as well as its
public hostname. Internal MCP also permits the configured local computer egress
bridge hostname, preserving Host validation for other origins.


## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/config-and-service-urls.md`
