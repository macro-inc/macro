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
  reuses the harness tool context and retains bearer authentication.
  Agent-led setup (behind `ENABLE_AGENT_SETUP`, off by default) is composed in
  `public_mcp.rs` from `ToolServiceContext::agent_setup_parts`:
  `public_mcp/sign_in.rs` (sign-in hook), `agent_led.rs` (handover),
  `setup_prompt.rs` (per-person setup hint, `setup` prompt), `setup_ports.rs`
  (the account adapter for `crates/agent_setup`), and `telemetry.rs`,
  `request_observer.rs`, `client_attribution.rs` (PostHog MCP analytics, only
  with setup on and `POSTHOG_API_KEY` set).
- `OPENAI_SUBMISSION.md` + `openai-plugin-package/`: OpenAI submission assets;
  `src/public_mcp.rs` preserves the domain verification endpoint configured by
  `OPENAI_DOMAIN_VERIFICATION_TOKEN`.
- `src/cognition/`: existing chat, completions, integrations, and projection
  workers; the library also exports their OpenAPI document.
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
- An import review's draft is `{source, excluded, shared, personal}`: the rows the owner left out and the rows whose sharing they flipped, passed to `start_notion_write` as `NotionWriteChoices`.
- One `ai_tools::ImportJobs` serves the whole process: session tools, public MCP, and `cognition::build` (the `/import/*` routes and the only stalled-Notion-import sweeper) share it, and `main.rs` hands running imports over on shutdown (`ImportJobs::hand_over`).
- `ApproveReview` lets the agent approve a presented review after the owner says yes in chat: `Actions::session` reports the turn's prompter from `agent_session.turn_prompter`, and `approvable` refuses an import whose plan is not `ready` for that review.
- Presenting an import review ties its plan to the review and the session (`attach_notion_review`); the import then produces `import.planned` and `review.settled` for that session itself, in the run's transaction (`crates/import`).
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

## Checks

- `cargo test -p agent_harness_service` (`SQLX_OFFLINE` unset).
- `just check` (`SQLX_OFFLINE=true cargo check`).
- `just run-local` — needs `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`,
  `GITHUB_TOKEN` in the environment or a local `.env`.

Code-mode credentials sign the authenticated session bot identity for SDK
message attribution after owner approval, while retaining user authentication.

## Configuration and lifecycle

All feature configs read the same harness `APP_SECRETS_JSON`; the harness
Doppler validation binary validates each config. `MCP_PUBLIC_URL` is the public
server origin (`mcp-server[-dev].macro.com`); `MCP_CLIENT_PUBLIC_URL` is the
integrations callback origin (`document-cognition[-dev].macro.com`). The shared
gateway preserves these hostnames and internally rewrites cognition paths. Both settings are required; keep them separate. `POSTHOG_API_KEY` and `POSTHOG_HOST` serve
feature flags, and MCP analytics while `ENABLE_AGENT_SETUP` is on; with it off MCP emits no
analytics events.
In deployed configs, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY`
is cognition's Secrets Manager reference; AI tools resolve the separate
`DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME` reference.

The shared Postgres pool defaults to 30 connections (`DATABASE_MAX_CONNECTIONS`).
Routine dispatch waits for the shared HTTP listener and calls its loopback
address, avoiding an ALB/self-startup race. Shutdown stops scheduling intake and
projection workers before draining sessions and pending publishes. Preview
listener failure shuts down the process so ECS can replace the task.

## Gotchas

- With `ENABLE_AGENT_SETUP` off, public MCP clients get exactly the
  instructions, tools and capabilities they had before agent-led setup; a test
  in `public_mcp/tool_service/test.rs` pins the text literally, so keep it in
  step when the preamble changes. `claude.com` among the default redirect
  hosts, and the auth proxy reading the client's registered name at sign-in,
  apply either way.
- Agent-led setup reaches, at sign-in, only accounts the sign-in created
  (`NEW_ACCOUNT_WINDOW`); the setup hint treats an account whose row hasn't
  landed yet as new. Someone who already had Macro gets one line of setup in
  the instructions, and the Setup tools hand over any account that never
  finished web onboarding if they ask.
- Keep two tasks and rolling replacements in both environments. Preview
  control uses shared Postgres state. SSH claims a tunnel owner; browser HTTP/WS
  forwards directly to that owner. Keep preview security-group self-ingress on
  TCP 8111 so peers can connect; live SSH handles remain local to each process.
- Two managed bots run on different runtimes: `@coder` (`HARNESS_BOT_ID`) in a
  Daytona sandbox, `@macro-new`/`@macro` (`INMEM_BOT_ID`) on the in-process ACP
  runtime — check which one a bug report is about before debugging containers.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/config-and-service-urls.md`
