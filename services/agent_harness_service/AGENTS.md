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
- `src/anthropic_gateway.rs` + `src/anthropic_gateway/`: `/anthropic/v1/messages`
  and `/anthropic/v1/messages/count_tokens` on the egress listener, for runtimes
  on Macro credits (Claude Code on a Macro computer). Both values come from
  the `macro_internal` MCP server in `session/new`/`load`/`resume`:
  `ANTHROPIC_BASE_URL` is its URL with `/mcp/internal` replaced by
  `/anthropic`, and `ANTHROPIC_AUTH_TOKEN` is the session egress token from
  its `Authorization: Bearer` header (re-minted on every attach, so restart
  the runtime with the latest one). Only sessions whose bot runs on a live Macro
  computer harness (`harnesses.computer_id`) are served; anything else, a
  failed lookup included, is a 403 with nothing forwarded. The
  `enable-macro-computers` rollout is not checked: it limits selling
  computers, not using them. Requests pass through unchanged with
  `ANTHROPIC_API_KEY`; only `anthropic-version`/`anthropic-beta` are
  forwarded. Models are a const allowlist (`ALLOWED_MODELS`, each mapped to
  its `ai_pricing` id, including the image’s bundled Claude Code Opus 4.8 and Sonnet 4.6
  defaults). `messages` is admitted as `AiFeature::AgentSession`
  for the session owner, and its `usage` (SSE `message_start`/`message_delta`
  or the JSON body) goes to the process's settling recorder, which charges
  only under `ENABLE_AI_USAGE_BILLING`. A caller that hangs up mid-stream does
  not stop the read: the rest is drained (up to ten minutes) so its usage is
  still recorded. Span: `anthropic_gateway.messages`.
- `src/computers.rs`: passes shared computer/pairing IDs and validated Macro buyer IDs
  directly between the hosted-runtime and harness services; configures the optional fleet operator, runs fleet effects,
  timers and reconciliation, and reports macrod presence. `COMPUTERS_FLEET` selects
  `incus` or local-only `docker`; absence means no attached fleet, emits one startup
  warning and starts no operator. Selected groups remain strictly validated.
  Shutdown stops computer passes through the shared CancellationToken and waits
  on their TaskTracker; fleet effects drain for up to thirty seconds and release
  unfinished leases. See hosted_runtimes' AGENTS.md for redeploy grace,
  bounded effect execution, and hard-kill recovery.
  `COMPUTERS_IMAGE` names the versioned image new computers are created
  from: an Incus alias such as `macro-box/2026-11-10`, or a Docker tag. Each
  computer records its own image; updates go through hosted_runtimes' image
  update routes, never by changing this value for existing computers.
  HostedHarnesses pairing records the buyer as the harness owner, but the
  harness belongs to the computer's team: its owner and admins manage it
  (Claude sign-in included) and every member can run agents on it.
  `src/computers/default_agent.rs` creates the team's `<buyer first name>'s Agent`
  (`Agent` without one, read from `macro_user_info`) coding agent through
  `BotService::create_agent` as the buyer (macrod harness, `default` model, all
  channels, owner connections, the bots default of bypassing permissions on a
  computer), skipping a harness `HarnessAssignments::bots_on_harness` already
  lists; the handle is the settings editor's slug, suffixed past handles the
  buyer sees. `HostedHarnesses::revoke` revokes the harness, then deletes every
  agent bound to any harness the computer had (`HarnessAgentDeletion`); computer
  harnesses keep their agents bound when deleted, so a retry still finds them.
- Computer lifecycle and gateway adapters carry canonical `ComputerId` and
  `HarnessId`; unwrap only at the harness/storage boundary.
- `src/computers/claude.rs`: Claude sign-in on Macro computers. All routes
  require the caller's `enable-macro-computers` flag through
  `hosted_runtimes::domain::rollout::ComputerRollout` (missing providers/flags
  and evaluation errors return 403) and an attached fleet (503).
  `POST /harnesses/{id}/claude-sign-in` → `{url}`,
  `POST /harnesses/{id}/claude-sign-in/complete` `{code}` → `{signedIn}`
  (a rejected code returns 422 with `code: "invalid_code"`),
  `POST /harnesses/{id}/claude-sign-out` → `{mode}`, and
  `GET /harnesses/{id}/claude-mode` → `{mode, account?}` (all manage rights).
  The sign-in link must be `https://claude.com` or `claude.ai` at exactly
  `/cai/oauth/authorize` or `/oauth/authorize`. A reported login needs a
  credential id of at most 100 `[A-Za-z0-9:._-]` bytes and an expiry no more
  than 400 days out (past expiries are real and allowed).
  The account has a signer, sign-in time and expiry, never an email or plan:
  Claude's setup-token credential names no account. Each route runs in a
  tracked task, so a completion whose caller left still records its signer.
- `src/computers/harnessd.rs`: `Harnessd` runs one `harnessd_protocol`
  request per `Fleet::exec(computer, ["harnessd"])` (request on stdin, one
  answer line on stdout) and writes the computer's Claude login rows from
  harnessd's status, under a per-computer Postgres advisory lock held from the
  command through the status read to the write. The lock is a session
  advisory lock, like the agent-session lock, taken with
  `pg_try_advisory_lock` on a dedicated pool of 4 connections (5 s acquire
  timeout): a computer another request holds answers 409 Busy at once, and
  the status pass skips it. The
  `ClaudeStatus` pass (every 60 s) refreshes every awake computer under the
  same lock (a sign-in nobody finished ends there once it is ten minutes old), and `sign_in_ahead.rs` refreshes on connect and then starts a
  sign-in when setup is unfinished or the credential expired. Spans:
  `computer.harnessd.command`/`.refresh`/`.refresh_all`.
- `src/computers/claude_expiry.rs`: the notices of the operator's
  `ClaudeSignIns` pass (every 60 s), whose sign-ins come from
  `hosted_runtimes::outbound::pg_sign_ins::PgClaudeSignIns` (active Claude
  logins with signer, `expires_at` and last notice, through harnesses'
  repository; the status pass lists awake computers with
  `ComputerOperator::awake_computers`); `IngressClaudeSignInNotices` addresses the team's owner and
  admins (`teams`) and sends `agent_sign_in_expiry` (agent `claude`; inbox, gateway, push)
  on the harness entity, with an id derived from harness, sign-in, stage and
  expiry so replicas and retries never notify twice.
- `src/public_mcp.rs` + `src/public_mcp/`: public workspace MCP and OAuth;
  reuses the harness tool context and retains bearer authentication. Wherever
  the harness can run code, every client but ChatGPT gets only
  `ExecuteCode`/`DescribeCodeTools`/`ReadCodeDocs` on `tools/list`
  (`tool_service.rs`) and can call only those; a native tool named directly
  is refused. ChatGPT gets the
  direct tools: its plugin directory refuses generic executors.
  `src/code_mode/ui_commands.rs` carries `macro.ui.open`: turn facts from
  the session repo, the `enable-agent-navigation` flag, Redis budgets and
  the gateway `ui_command` send.
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
  (`src/scheduling/routine_run_notifications.rs`), which names a
  sub-routine's run "<name> · from <parent>". `with_run_sessions` hands the
  scheduler the code-mode invocation lookup so a routine an Ask AI step's
  session creates becomes its run's sub-routine. AI drafts routines
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
  Pipedream apps. Generations (`crates/suggestion_generation`) run their
  suggestions and routines sessions hidden on the free tier's model, each kind
  gated on its flag (`enable-suggestions`, `enable-routine-suggestions`).
  `scheduling.rs` sweeps generation sessions a stopped process left open
  every minute and starts nightly generations every five minutes, once the
  process is ready.
  The suggestions routes are served here too, and `scheduling.rs` runs suggestions'
  resolution consumer (group `suggestions-resolution`, `crates/suggestions`) beside the
  event intake, under the same readiness gate and shutdown.
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

Computer fleets require `COMPUTERS_CONTROL_PLANE_ID` whenever `COMPUTERS_FLEET`
is `incus` or `docker`. Omit the selector and fleet settings when no fleet is attached;
`disabled`, blank and unknown selections are invalid. PostHog
`enable-macro-computers` remains the only product rollout gate.
Read the stable identity from Doppler in deployed environments; local stacks
explicitly set `local-<instance>`. Distinct control planes sharing a host
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
`OVERRIDE_*` values for local instances; each computer enrollment carries a
typed `Deployment` resolved from this process's `macro_service_urls` values
(`computers::ServiceDeployment`) when it is issued. The shared gateway preserves the public
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
Computer lifecycle observations use one additional dedicated lock connection per
replica. Serialize connect/disconnect effects by harness across replicas and check
durable live connections before emitting a disconnect, so an old socket cannot
mark its replacement offline. Keep this lock pool separate from repository pools
to avoid exhausting the connections needed inside the guarded operation.
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
  `agent_via`. The OAuth broker signs the same Macro bot attribution into the
  tokens it issues for the ChatGPT MCP Worker's resource
  (`McpChatgptServiceUrl`; `public_mcp/macro_api_tokens.rs`). Never read a bot
  id or client name from the request itself.
- The public MCP server is stateless, so tool calls carry no `clientInfo`; the
  client is identified per call by its `User-Agent` / `x-anthropic-client`
  headers and per session by `$mcp_initialize`.

Local MCP uses both configured egress addresses in the in-process catalog;
the public MCP transport permits its typed service hostname as well as its
public hostname. Internal MCP also permits the configured local computer egress
bridge hostname, preserving Host validation for other origins.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/config-and-service-urls.md`

- Code-mode credentials create durable per-invocation agent correlation; the final merged HTTP router validates incoming attribution before handlers.

- `harness_bindings.rs` resolves runtime routing through the harness, bot assignment, and session lookup ports; each owning crate reads its own table.

Hosted computer Claude account requests require the operator-derived
`FleetAttachment` after the existing rollout and Manage authorization (on a
computer, the team's owner and admins); no
attachment answers typed 503 before any command. macrod ingress keeps its
existing authorization.
Authentication checks the owning hosted host heartbeat per request, so its
attachment observation can briefly differ from this service's operator presence.
