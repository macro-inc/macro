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
- `src/runtime_gauges.rs`: one task recording, every minute, what the process
  holds per session as OTel gauges (`ahs.harness.workers`,
  `ahs.harness.hydrated`, `ahs.agent_session.active` (every runtime's actors),
  `ahs.inmem.store_sessions`, `ahs.inmem.live_agents`,
  `ahs.tokio.alive_tasks`); no per-session attributes.
- `src/trigger.rs`: turns channel/webhook triggers into sessions.
- `src/pull_request_archive.rs`: consumes `macro.github_pull_requests` (group
  `agent-harness-pull-request-archive`) and auto-archives sessions whose
  linked pull requests finished (`agent_session::domain::auto_archive`), and
  ends their work registrations first
  (`agent_session::domain::work_registration`).
- `src/internal_mcp.rs`: the internal MCP server exposed to running sessions.
- `src/public_mcp.rs` + `src/public_mcp/`: public workspace MCP and OAuth;
  reuses the harness tool context and retains bearer authentication. Wherever
  the harness can run code, every client but ChatGPT gets only
  `ExecuteCode`/`DescribeCodeTools`/`ReadCodeDocs` on `tools/list`
  (`tool_service.rs`); hidden native tools stay callable. ChatGPT gets the
  direct tools: its plugin directory refuses generic executors.
  `src/code_mode/connected_apps.rs` serves a running execution's
  `macro.connectedApps` through the in-process egress service.
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
  `src/cognition/api/confirmed_actions.rs` runs a confirmed tool as the
  caller: `POST /cognition/email/send-confirmed` (`SendConfirmedEmail`, the
  SDK's `email.sendConfirmed` and `EmailMessage.forwardConfirmed`) and
  `POST /cognition/calendar/events/create-confirmed`
  (`CreateConfirmedCalendarEvent`, `calendar.createConfirmed`): the only
  immediate send or create open to an agent's program besides a review.
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
  (`src/scheduling/routine_run_notifications.rs`). AI drafts routines
  (`POST /scheduled-actions/drafts`) in ordinary hidden sessions of the
  in-process Macro agent on the person's Ask AI model, admitted and billed
  as their agent session usage; `scheduling.rs` composes the drafter, its
  `scheduled_action_draft` store, the check's code-mode invocation lookup
  (`CorrelationSessions`), what a session created from its agent activity
  (`ActivityCreations`) and the sweep of drafts a stopped process left.
  Routine code steps run through `src/routine_code.rs`,
  on routines' own Deno executor (own slots, CPU limit, lower priority) and
  type checker, with a token for the owner's access (`mint_for_routine`):
  attributed to Macro acting for them, or, when the routine sets
  `dangerously_operate_as_user`, to the owner with no agent badge. Every such
  token carries the routine id, which the events its writes produce keep, so
  they never start routines.
  Routine suggestions (`src/scheduling/routine_suggestions.rs`) read the
  newest 100 messages (labels, 500-character snippets) through
  email_service's internal recent-messages route and the person's connected
  Pipedream apps; their hidden sessions run on the free tier's model, gated
  on `enable-routine-suggestions`. `scheduling.rs` sweeps suggestion
  sessions a stopped process left open every minute.
  A routine's code steps are checked together, one file each; the owner's
  time zone for `run.timezone` comes from their primary calendar
  (`CalendarTimeZones`).
  A step waits up to five minutes for one of `ROUTINE_CODE_SLOTS` before its
  credential is minted, so its token and 30-second limit start when it runs;
  a step that never gets one fails with "Macro was busy running other
  routines".
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

- `cargo test -p agent_harness_service` (`SQLX_OFFLINE` unset). Add
  `-- --include-ignored` with Deno 2.9.6 on `PATH` for the real-runtime
  routine code tests.
- `just check` (`SQLX_OFFLINE=true cargo check`).
- `just run-local` — needs `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`,
  `GITHUB_TOKEN` in the environment or a local `.env`.

Code-mode credentials sign the session bot for SDK attribution and the selected
user for API authorization; owner approval is required only for cross-account
access. Lifecycle, runtime provider connections, billing, and memory stay owner-scoped.

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
analytics are off and routine template publishing, reads, and activation are
disabled. Scheduling wires the per-user `enable-routine-sharing` PostHog gate;
owner unsharing and already activated routines remain available.
`AUTHENTICATION_SERVICE_SECRET_KEY` is required in harness, cognition, and
scheduling configs regardless of billing flags. It is a Secrets Manager name
in deployed configs and a direct key locally. Resolve it for the harness, cognition, and
scheduling configs before building authentication service clients; the task
role must allow reading its ARN.
In deployed configs, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY`
is cognition's Secrets Manager reference; AI tools resolve the separate
`DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME` reference.

The binary allocates with mimalloc (`#[global_allocator]` in `src/main.rs`):
glibc malloc kept freed memory resident as fragmentation under this
workload. Tests and the library keep the system allocator.

`AGENT_SESSION_IDLE_TIMEOUT_SECS` (default 900, so no Doppler key) is how long
a session's command worker waits before it releases a quiet session from
memory and exits; lower it only to exercise the release end to end. Values
below 30 fail startup.

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
- Public MCP tool calls run for the `ToolCaller` the bearer middleware
  (`mcp_auth_proxy`) attached, and a call without one is refused: `Agent` (a
  Macro API token's signed `agent_id`, which egress mints from the session's
  `agent_session.bot_id`) writes as that agent, under the bot's own name (read
  per call, so its document edits label their live cursors with it);
  `McpClient` (OAuth) writes as the Macro bot labelled with the client's name
  (shown as the author); `ApiKey` writes as the Macro bot. Public `ExecuteCode`
  builds its context per call from the caller and signs the same attribution
  into its SDK token: the agent, or the Macro bot plus the client name as
  `agent_via`. The OAuth broker signs the same Macro bot attribution into the
  tokens it issues for the ChatGPT MCP Worker's resource
  (`McpChatgptServiceUrl`; `public_mcp/macro_api_tokens.rs`). Never read a bot
  id or client name from the request itself.
- The public MCP server is stateless, so tool calls carry no `clientInfo`; the
  client is identified per call by its `User-Agent` / `x-anthropic-client`
  headers and per session by `$mcp_initialize`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/config-and-service-urls.md`

- Code-mode credentials create durable per-invocation agent correlation; the final merged HTTP router validates incoming attribution before handlers.
