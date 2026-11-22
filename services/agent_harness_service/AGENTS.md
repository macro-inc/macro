# agent_harness_service

## What it is

The single deployed agent backend: sessions, chat/completions, public workspace
MCP, routine scheduling, and SSH/HTTP previews all run in this process. The
app-wide connection gateway remains a separate realtime service. Preview DNS,
HTTPS/SSH load balancers, and the retired projection queue have
network/resource-only Pulumi stacks; they do not host extra agent processes.

## Start here

- `src/lib.rs`: composition root (`run()`) — builds Postgres repositories, the
  container manager, channel/session services, and wires
  `macro.channels`-derived triggers into `macro.agent_sessions`. All modules
  live in the library so the crate compiles once and caches; `src/main.rs` only
  starts it (allocator, `MacroEntrypoint`, `run()`). Never add a `mod` to
  `main.rs`.
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
- `src/cognition/server.rs`: both email-service compositions inject CRM rule
  discovery; selected Team reads fail closed if a host omits that capability.
- `src/trigger.rs`: turns channel/webhook triggers into sessions.
- `src/pull_request_archive.rs`: consumes `macro.github_pull_requests` (group
  `agent-harness-pull-request-archive`) and auto-archives sessions whose
  linked pull requests finished (`agent_session::domain::auto_archive`), and
  ends their work registrations first
  (`agent_session::domain::work_registration`).
- `src/internal_mcp.rs`: the internal MCP server exposed to running sessions.
  Each call runs in an `internal_mcp.call_tool` span parented from the
  request's `_meta` trace context, which the in-process agent sends
  (`mcp_toolset::TraceContext::Propagate`), so `code_mode.execution` and the
  sandbox's SDK calls join the session's trace.
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
  defaults and agent teammates’ Sonnet 5.5 calls). `messages` is admitted as `AiFeature::AgentSession`
  for the session owner, and its `usage` (SSE `message_start`/`message_delta`
  or the JSON body) goes to the process's settling recorder, which charges
  only under `ENABLE_AI_USAGE_BILLING`. A caller that hangs up mid-stream does
  not stop the read: the rest is drained (up to ten minutes) so its usage is
  still recorded. Span: `anthropic_gateway.messages`.
  `/brain/anthropic/*` serves agent teammates' brains the same way, but
  authenticates the agent's own Macro API key (`anthropic_gateway/brain.rs`)
  and counts usage against the agent account, with no session entity. It
  serves only agents with `enable-agent-teammates` on for their creator
  (`BrainRollout` over `agent_credentials::rollout`; PostHog never targets an
  agent's own account; a deleted creator falls back to the team owner; no
  provider, no one to follow or a failed load refuses with
  403). Agent git and agent MCP keys share the same check.
  While a person drives the agent's computer, `HeldBrains` (around the one
  `BrainAuthenticator` every `/brain/*` route shares) holds each request until
  the hand-back, woken by `computer_screen`'s lease notifications, for at most
  5 minutes (at once on shutdown), then answers 503 `overloaded_error` with
  `Retry-After: 10`. The agent is also frozen while a person drives (see
  `guest_files.rs` below), so the hold matters only to an agent that
  restarted mid-drive. Take-over and hand-back notices (the driver by name,
  never their id) go only to the agent's main loop: a
  `/brain/anthropic/v1/messages` request marked `x-macro-agent-loop: main`
  (the starter agent's `behavior/agent/claude.ts` sets it through
  `ANTHROPIC_CUSTOM_HEADERS`) that offers tools, so neither the runtime's
  side queries nor Claude Code's tool-less side calls take them. They go
  last in its last user message, after its `tool_result` blocks, as
  `<macro-runtime-notice>{json}</macro-runtime-notice>` text blocks with `<`,
  `>` and `&` escaped (`anthropic_gateway/screen_notices.rs`); each is
  claimed by one request at a time, deleted once upstream's answer finished
  (a 2xx JSON body read whole, or a stream that reached `message_stop` with
  no broken chunk) and given back otherwise, an SSE `error` after the 200
  included. A subagent's requests carry the same mark and may
  take them, and they are not kept in the agent's history: a hint for its
  next turn, not a record. An agent on its owner's own Claude plan never
  reaches this gateway, so it gets no notices.
- `src/speech_gateway.rs` + `src/speech_gateway/`: `/brain/inference/stt` and
  `/brain/inference/tts` WebSockets on the egress listener, for agent
  teammates' calls (`MACRO_SPEECH_URL` in the enrollment). Same brain key,
  `enable-agent-teammates` check and admission as `/brain/anthropic`; the upgrade query must be exactly
  `model=deepgram/nova-3` (STT) or `model=deepgram/aura-2` (TTS). The gateway
  opens LiveKit Inference with a 60-second `inference.perform` JWT signed with
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (both empty: speech is off; one
  alone fails startup) and relays events. `protocol.rs` pins the session:
  Nova-3 English STT on mono PCM16 16 kHz, Aura-2 TTS as PCM16 24 kHz with a
  catalog voice; a second `session.create`, an unknown field or a changed
  voice closes the socket. Forwarded PCM seconds and synthesized characters
  are recorded once, when the socket closes, against the agent
  (`livekit-inference-deepgram-*` pricing rows). Upstream error details stay
  in logs. Span: `speech_gateway.session`; never record transcripts or text.
- `src/voice_gateway.rs`: `GET /voices` and `GET /voices/{model}/sample` for
  team admins behind `enable-agent-teammates` (`team_agents::domain::voice`).
  The Deepgram catalog (Aura-2 only) is cached for a day, and each voice's
  fixed-line WAV sample per process, billed to the admin's team when it is
  synthesized.
- `src/computers/moves.rs`: `POST /internal/computers/{id}/move` `{"toHost"}`
  and `GET /internal/computers/{id}/moves` (internal API key only): start and
  watch moving a computer to another host; the operator's move pass (every
  5 s) does the work.
- `src/computers/agent_enrollment.rs`: the operator's `AgentEnrollmentSource`;
  every computer creation asks the auth service's internal
  `/internal/team_agent_enrollment` route, so an agent computer never enrolls
  without its agent.
- `src/computers.rs`: passes shared computer/pairing IDs and validated Macro buyer IDs
  directly between the hosted-runtime and harness services; configures the optional fleet operator, runs fleet effects,
  timers and reconciliation, and reports macrod presence. `COMPUTERS_FLEET` selects
  `firecracker` (every `hosted_runtime_host` row with an endpoint, through
  `HostFleets`) or local-only `docker`; absence means no attached fleet, emits one
  startup warning and starts no operator. `incus` is retired: it logs an error and
  attaches no fleet (removed once Doppler dev/prd no longer set it). Selected groups
  remain strictly validated.
  Shutdown stops computer passes through the shared CancellationToken and waits
  on their TaskTracker; fleet effects drain for up to thirty seconds and release
  unfinished leases. See hosted_runtimes' AGENTS.md for redeploy grace,
  bounded effect execution, and hard-kill recovery.
  `COMPUTERS_IMAGE` names the versioned image new computers are created
  from: a Firecracker image such as `macro-box/2026-11-10`, or a Docker tag;
  `COMPUTERS_AGENT_IMAGE` the agent-mode one agent teammates' computers get
  (`macro-box-agent/2026-11-10`, `macro-box-agent:latest`). Each
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
  and evaluation errors return 403 with `code: rollout_disabled`; a caller
  without manage rights gets a 403 with no code) and an attached fleet (503).
  `POST /harnesses/{id}/claude-sign-in` → `{url}`,
  `POST /harnesses/{id}/claude-sign-in/complete` `{code}` → `{signedIn}`
  (a failed sign-in carries a `code` saying how to recover:
  `invalid_code` 422 and `sign_in_expired` 410 need a new sign-in,
  `malformed_code` 400 a fresh paste, `computer_unreachable` 503 and
  `computer_busy` 409 a retry; harnessd's own CLI timeout ends the sign-in
  and answers `sign_in_expired`, while this service timing out on harnessd
  is a bare 504 that lets the code be sent again),
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
- `src/computers/screen.rs` + `src/computers/screen/`: agent screens over
  VNC (domain in `crates/computer_screen`). `POST
  /computers/{harness_id}/screen/tickets` `{transport: vnc, surface: desktop,
  mode}` → `{ticket, expiresAt, url}` takes the account holder's own
  credential (`AccountHolderOrInternal`), refuses programs
  (`is_program_run`) and agent accounts, checks the rollout and the harness
  (`View` to watch, `Manage` to drive; `access.rs` adapts both, and people's
  names, to the domain's ports), limits tickets per person, and mints a
  single-use 60 s ticket;
  `GET /computers/{harness_id}/screen/ws?ticket=` redeems it and runs the
  socket (`socket.rs`): binary frames are raw RFB both ways, text frames JSON
  control (`takeOver`, `handBack`, `input`, `visibility`, `stop`; server
  `state`/`error`/`ended`), with access (rollout included) re-checked and the
  socket marked seen every 30 s and on every take-over (three failed lookups
  in a row end it, as do three failed touches or a row another socket ended
  as `lost`); a driver who loses access releases the lease at once.
  `state.driver` is `{name, isYou}`, never a user id; `state.leaseId` is an
  opaque id per drive. A socket with no `visibility` `visible: true` (the
  viewer repeats it) and no input for 10 minutes, or 2 minutes after
  `visible: false`, ends `idle`, handing back if it drives. A person opens at most 4 sockets on a
  computer, and a computer 16 watching sockets (`tooManySockets`; driving
  sockets don't count against it). Its own task writes the WebSocket
  through a bounded outbox, so a viewer that stops reading never stalls the
  loop: media waits when the outbox fills and resumes as soon as a frame
  leaves it, and a write that takes 10 s ends the socket. Raw RFB from the
  viewer that media has no room for waits in the loop (reading the viewer
  pauses meanwhile, so order holds) while media keeps running; 10 s of no
  room ends the socket `tunnelFailed`. The `viewers` count in `state` is this replica's. An open
  socket, watching or driving, keeps the computer awake (`in_use.rs`).
  Before the first frame the socket wakes a hibernated computer
  (`state.waking`). One driver lease per computer, renewed by driver input at
  most every 15 s; a take-over by the same user moves it to the new socket,
  `state.drivingHere` says which socket holds it, and any socket of the
  driver may hand back. `media.rs` `VncMedia` relays raw RFB from Xvnc (5901)
  through `rfb.rs` `RfbGate`, which drops input unless this socket drives
  before its lease's expiry, keeps SetEncodings to what `RfbServerFilter` can
  frame (Raw, CopyRect, ZRLE and pixel-free pseudo-encodings; no
  ExtendedClipboard, so the clipboard is plain Latin-1), speaks RFB 3.8 and
  32-bit true-colour pixels only (any other SetPixelFormat closes it),
  and fails closed on anything it can't parse; `RfbServerFilter` frames
  Xvnc's side without decoding pixels and drops ServerCutText unless this
  socket drives (Xvnc runs with `-SendPrimary=0`); typed `input` goes through
  `RfbInjector`'s own RFB connection (handshake and each input bounded to
  10 s; the drive is checked again after the handshake and the input is
  bounded by the lease's end, so a lease that lapsed while connecting lets
  nothing through). A drive that ends in the middle of the guest's
  clipboard ends the socket rather than pass the rest. Xvnc is reached only by a `socat`
  tunnel over `tunnel.rs` `GuestExec` (the operator's `Fleet::exec`,
  implemented in `computers.rs`): nothing before its ready line is media,
  and a tunnel still running 2 s after its session closed is killed (on the
  computer tasks' tracker, only if the pid is still that socat). When
  media stops short, the operator says whether the computer runs, which
  picks `computerOff` or a named error (`tunnelFailed`, `sourceUnavailable`).
  Screens count as in use for hibernation (`in_use.rs`); relief reads that
  before it suspends, with no lock against a screen opening meanwhile, so a
  screen opened in that window sees the computer go off and wakes it when
  opened again. `guest_files.rs`
  freezes the agent for a drive before a take-over counts (`freeze <drive>`
  through `socat` to the guest's root-owned `/run/macro-agent-pause/sock`,
  `nix/macro-box/files/macro-agent-pause`; `frozen`/`idle` let it start,
  anything else refuses it with `agentNotPausable`), sends `keep <drive>` on
  each lease renewal (the guest thaws the agent itself 3 minutes after the
  last; a keep answering `thawed`, `superseded` or `failed` is reported to
  `ScreenService::refreeze`, which freezes again only while that drive is
  live, and otherwise ends it with `agentNotPausable` to the driver;
  `computers/screen/refreezes.rs` runs each computer's refreezes one at a
  time in their own task, keeping the latest request that comes meanwhile
  for right after), and
  `thaw <drive>` after (the guest never freezes a thawed drive again; a few
  tries off the request path, then `ScreenService::reap`; `superseded` means
  a newer drive froze it). A computer that isn't running is never exec'd
  into. An agent computer whose image has no helper fails a freeze and has
  nothing to keep or thaw (`idle`). A take-over whose access check fails answers
  `takeOverUnavailable` and keeps the socket. It
  keeps `/home/macro/agent/state/screen-driver` (`human` while someone
  drives; only each computer's latest change, written a few computers at a
  time by one worker, never on a request path) and `state/harness-id`
  (written from `sign_in_ahead.rs`). Each replica runs `ScreenService::reap`
  every minute (lapsed leases, owed thaws).
  Spans: `computer.screen.ticket`/`.session`/`.wake`/`.tunnel`/`.driver_file`/
  `.freeze`/`.thaw`, and `ScreenService::reap`'s per round.
- `src/computers/claude_expiry.rs`: the notices of the operator's
  `ClaudeSignIns` pass (every 60 s), whose sign-ins come from
  `hosted_runtimes::outbound::pg_sign_ins::PgClaudeSignIns` (active Claude
  logins with signer, `expires_at` and last notice, through harnesses'
  repository; the status pass lists awake computers with
  `ComputerOperator::awake_computers`); `IngressClaudeSignInNotices` addresses the team's owner and
  admins (`teams`) and sends `agent_sign_in_expiry` (agent `claude`; inbox, gateway, push)
  on the harness entity, with an id derived from harness, sign-in, stage and
  expiry so replicas and retries never notify twice.
- The operator's `SetupNotices` port is `IngressSetupNotices` in
  `crates/team_agents` (`outbound/setup_notices.rs`), shared with the auth
  service's agent ready notice; see that crate's `AGENTS.md`.
- `src/public_mcp.rs` + `src/public_mcp/`: public workspace MCP and OAuth;
  reuses the harness tool context and retains bearer authentication. Wherever
  the harness can run code, every client but ChatGPT gets only
  `ExecuteCode`/`DescribeCodeTools`/`ReadCodeDocs` on `tools/list`
  (`tool_service.rs`) and can call only those; a native tool named directly
  is refused. ChatGPT gets the
  direct tools: its plugin directory refuses generic executors.
  `src/code_mode/ui_commands.rs` carries `macro.ui.open`: turn facts from
  the session repo, Redis budgets and
  the gateway `ui_command` send.
  `src/code_mode/connected_apps.rs` serves a running execution's
  `macro.connectedApps` through the in-process egress service; a scoped
  session's code is refused it, and its turn calls no remote MCP tool
  directly either (`ScopedToolGate::refuse_remote_mcp`). The actor MCP
  transport is wrapped in `agent_egress::outbound::budgeted_mcp`, so each
  account's calls to an app are paced; a call still rate limited answers
  HTTP 429 to the SDK, which throws.
  Code execution's destination list in `src/code_mode.rs` (`SdkHost`) also
  includes the configured editing worker, whose comment-mark endpoint requires
  a scoped document token; this does not grant permission to edit document
  content. The test `every_sdk_host_holds_a_scoped_credential_to_its_scope`
  fails for a host the SDK can reach (`code_mode_assets::HOSTS`) that isn't
  an `SdkHost`, and records how each host's service holds a scoped session's
  credential to its scope: `propagate`, `enforce_signed_scope`, or no Macro
  credential accepted. A new host picks one before it ships.
  `src/public_mcp/analytics.rs` sends PostHog `$mcp_initialize` /
  `$mcp_tool_call` events (PostHog MCP analytics schema) in the background,
  with the user's team as the `team` group. At most 64 sends run at once
  (more are dropped) and each user's team is cached for 10 minutes.
- `src/cognition/`: existing chat, completions, and integrations; the library
  also exports their OpenAPI document.
  `src/cognition/service/integration_analytics.rs` sends PostHog
  `integration_connected` / `integration_disconnected` for native MCP servers
  and Pipedream apps, from the router hooks wired in `src/cognition/server.rs`.
  `src/cognition/api/confirmed_actions.rs` runs a confirmed tool as the
  caller: `POST /cognition/email/send-confirmed` (`SendConfirmedEmail`, the
  SDK's `email.sendConfirmed` and `EmailMessage.forwardConfirmed`) and
  `POST /cognition/calendar/events/create-confirmed`
  (`CreateConfirmedCalendarEvent`, `calendar.createConfirmed`): the only
  immediate send or create open to an agent's program besides a review.
  A scoped hidden session's chat messages and structured completions take
  no tools (`tool_selection::tools_refused_to_current_session`): tools run
  with the person's full access, past the scope its credential carries.
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
  (`POST /scheduled-actions/drafts`) in a hidden session of the in-process
  agent, which runs a background session given instructions at low effort
  and delivers its replies unseen (`containers.rs`, `reply_delivery`).
  Before the session starts, a fast call on the router names what the
  words refer to (`src/scheduling/routine_drafting.rs`:
  `RouterDraftModels` admits and bills it as the person's automation
  usage), and `SearchNames` looks channel, folder, document and task
  names up with the existing name search (document storage's
  `/internal/search` and `/internal/search/channel/name`, exact match, as
  the person, five-second timeout), comparing names exactly itself. A
  name whose search fails, runs out of time, or has more hits than one
  page (newest first) without two exact matches goes to the session,
  which also looks up the other kinds. `routine_code.rs` gives the
  session each SDK area it needs
  (`area_reference`: the area's index, guidance and declarations from every
  namespace in the topic, then the generated types they import). `scheduling.rs` composes the drafter
  after the service with its
  `scheduled_action_draft` store, the session drafter's check lookup
  (`CorrelationSessions`) and activity (`ActivityCreations`), and the
  sweep of drafts a stopped process left.
  Background drafts (`/scheduled-actions/draft-jobs`, `DraftJobs`) run on
  the scheduling `workers` tracker under `stop_workers`, so shutdown fails
  the ones still drafting as interrupted within `SHUTDOWN_TIMEOUT`; they
  share the draft store, push `routine_draft_update` through the connection
  gateway, and the same minute's sweep fails drafts whose replica died.
  Code runs (session, public MCP and routine steps) reach the SDK hosts
  through the runner's loopback forwarder for users with the PostHog flag
  `enable-code-execution-egress-proxy` (`code_mode::EgressRollout`); with no
  flag client, the flag off or the flags unreadable, they go directly. The
  answer is cached per user for 60 s (10 s after a failed read), so a run
  doesn't wait on PostHog (span `code_execution.egress_flag`, `cache`).
  Routine code steps run through `src/routine_code.rs`,
  on routines' own Deno executor (own slots, CPU limit, lower priority) and
  type checker, with a token for the owner's access (`mint_for_routine`):
  attributed to Macro acting for them, or, when the routine sets
  `dangerously_operate_as_user`, to the owner with no agent badge. Every such
  token carries the routine id, which the events its writes produce keep, so
  they never start routines. A dry run's token (a code upgrade's check of a
  rewritten step, at run time or in the startup sweep) also signs the
  `dry_run` scope (`routine_claims`), so every SDK host refuses its writes
  even when code gets past the dry run inside its process.
  Entity knobs' items are checked as the owner on save, and in a run when
  the first code step that uses each starts (`KnobEntityAccess`, people through notifications' user check, and
  trash and a task's subtype through `RoutineLiveItems` in
  `src/scheduling.rs`).
  Routine suggestions (`src/scheduling/routine_suggestions.rs`) read the
  newest 100 messages (labels, 500-character snippets) through
  email_service's internal recent-messages route, the person's connected
  Pipedream apps, and whether CRM's company tools would let them add a
  company (a team, and CRM access in it). Generations (`crates/suggestion_generation`) run their
  suggestions and routines sessions hidden on the free tier's model, each kind
  gated on its flag (`enable-suggestions`, `enable-routine-suggestions`).
  `scheduling.rs` sweeps generation sessions a stopped process left open
  every minute and starts nightly generations every five minutes, once the
  process is ready.
  Accepted background prompt suggestions run in hidden, billable sessions of the
  in-process Macro agent (`SuggestionRunSessions` in `scheduling.rs`, which reads
  every page of a session's activity for what it created, each item once). Runs
  move from their sessions' lifecycle events and a reconcile sweep every five
  minutes. Reply suggestions read who they wait on from their email thread or
  channel message through `ItemReplyWaits` (`crates/suggestions`), built over
  the email repository and the shared pool. The suggestions routes are served
  here too, and `scheduling.rs` runs
  suggestions' resolution consumer (group `suggestions-resolution`) and runs
  consumer (group `suggestions-runs`, both `crates/suggestions`) beside the
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
- `src/agent_git.rs`: agent teammates' workspace repos (`crates/agent_git`)
  under `/agent-git` (smart HTTP plus the internal create/ensure/delete API;
  `AgentGitServiceUrl` points here), merged outside the gzip layer. Storage
  is EFS at `REPO_STORAGE_ROOT` (`/data/agent-git`, the
  `agent-harness-service` stack's file system and access point), chosen
  because it is the simplest store git can use directly that both replicas
  share. Each repo's push budget is a row in Postgres and each receive-pack
  (and create/ensure/delete) holds a per-repo Postgres advisory lock, so the
  replicas never interleave writes to one repo; git's lockfiles on EFS are
  the second guard. Startup fails without git and `git-http-backend`, or
  without the directory; shutdown drains running git processes for up to
  8 s. Config: `REPO_STORAGE_ROOT`, `MAX_REPO_SIZE_BYTES`,
  `PUSHES_PER_MINUTE` (required; locally the `agent_git_repos` compose
  volume and 500 MiB / 30).
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
  `src/model_providers/mod.rs` → wire into `src/lib.rs`.
- Inspect a session's protocol log: `just session-log <channel_id>`.

## Tool contracts

- Internal session tools require explicit `acting_as`, resolved by the shared gate, plus existing owner/edit authorization. SDK executions choose one account for the whole program; review decisions use the saved acting account. Keep their restricted prompt/stop route separate from human approval controls.
- An import review's draft is `{source, excluded, shared, personal}` (`source` is `notion`, `linear`, or `jira`): the rows the owner left out and the rows whose sharing they flipped, passed to `start_workspace_write` as `NotionWriteChoices`.
- One `ai_tools::ImportJobs` serves the whole process: session tools, public MCP, and `cognition::build` (the `/import/*` routes and the only stalled workspace-import sweeper, which adopts Notion, Linear and Jira runs) share it, and `run()` in `lib.rs` hands running imports over on shutdown (`ImportJobs::hand_over`).
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
is `firecracker` or `docker`. Omit the selector and fleet settings when no fleet is attached;
`disabled`, blank and unknown selections are invalid. PostHog
`enable-macro-computers` remains the only product rollout gate; dev may add
`COMPUTERS_ROLLOUT_ALLOWLIST` (Macro user ids admitted without it; refused in
production).
Read the stable identity from Doppler in deployed environments; local stacks
explicitly set `local-<instance>`. Distinct control planes sharing a host
must use distinct identities; replicas of one control plane share an identity.

An enabled fleet also requires `COMPUTERS_IMAGE` and `COMPUTERS_AGENT_IMAGE`; how
far each host is overcommitted is its own row's settings
(`docs/runbooks/computer-overcommit.md`).
Firecracker additionally requires `COMPUTERS_FIRECRACKER_CLIENT_CERT` and
`COMPUTERS_FIRECRACKER_CLIENT_KEY`, the mTLS identity every host agent trusts; each
host's endpoint and pinned certificate are on its row. Docker additionally requires
`COMPUTERS_HOST_NAME`, `COMPUTERS_DOCKER_MEMORY_GB`, network and enrollment directory.
Missing values fail startup with the variable name; fleet-specific values are required only for that fleet.
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
workload. Tests and the library keep the system allocator, so the allocator
stays in `main.rs` while everything else lives in `src/lib.rs`.

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
Harness presence lease renewals use one more dedicated connection
(`harness_bindings.rs`, each renewal bounded to 5 s), so a starved shared pool
can't lapse the leases of live harnesses. A renewal cut off by that bound closes
its connection instead of returning it: sqlx's unbounded return ping would let a
silent socket hold the only slot.
Routine dispatch waits for the shared HTTP listener and calls its loopback
address, avoiding an ALB/self-startup race. Shutdown stops scheduling intake and
cognition workers before draining sessions and pending publishes. Preview
listener failure shuts down the process so ECS can replace the task.

## Gotchas

- Keep computer domain IDs and harness IDs typed in `computers.rs`; unwrap only when calling the existing harness registry or SQL boundary.

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
- Each public tool call runs in a `public_mcp.call_tool` span (tool name, mode,
  caller kind, outcome) carrying only opaque caller ids: `fusionauth_user_id`,
  the OAuth `mcp.client.id` and registered `mcp.client.name`, or `agent_id`,
  from `mcp_auth_proxy`'s `McpCallerIds`. Never put the Macro user id, an
  email, on it. Span-reading tests share `test_spans::exported_spans()`, the
  binary's one global subscriber.

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
