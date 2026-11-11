# agent_session

## What it is

Part of agent sessions: the coding-agent session entity itself — lifecycle,
control, sharing, and the Postgres/HTTP surface every agent-harness
consumer talks to.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the session service and
  its ports — the widest surface in the crate.
- `src/domain/lifecycle.rs`: create/resume/stop state machine.
- `src/domain/model.rs`: the `AgentSession` entity shape.
- `src/domain/turn_state.rs` + `src/domain/control.rs`: per-turn state and
  the control-plane commands (used by held tool-call approvals).
- `src/inbound/axum_router.rs`: the HTTP surface. `GET /{id}/log` serves raw
  frames for the web client's wasm fold; `GET /{id}/log/folded` serves the
  same fold run server-side for the SDK and agents.
- `src/domain/read.rs` and `src/inbound/toolset/read_agent_session.rs`: bounded,
  view-authorized conversation reads using the shared transcript fold.
- `src/domain/coding_agents.rs` + `src/inbound/coding_agents.rs`: coding persona
  discovery and dispatch; `GET /coding-agents` serves the signed-in user's
  listing to the SDK, the `/internal/coding-agents` commands serve tools.
- `src/domain/updates.rs`: owner-scoped blocked and stalled coding-session updates,
  capped to 25 sessions before folding their logs. Served to the caller by
  `GET /agent-sessions/updates` (`inbound/axum_router/updates.rs`) and to the
  `ListAgentUpdates` tool by `/internal/coding-agents/updates`.
- `src/domain/session_task.rs`: a session's task. The `link_task` MCP tool and
  `PUT /agent-sessions/{id}/task` (`inbound/axum_router/task.rs`, owner only)
  share `SessionTasks::link_task`.
- `src/outbound/postgres.rs`: the session repository.
- `src/outbound/broker_lifecycle_publisher.rs` /
  `broker_log_realtime.rs`: Kafka publication of lifecycle and log events.

## Scope

- Owns: session identity, lifecycle, sharing/audience, credentials, pull
  request links, and the Postgres/HTTP/Kafka adapters for all of that.
- Not here: container provisioning and runtime wiring → `agent_harness`,
  `agent_inmem`; PR diff capture → `agent_changes`; the ACP wire format →
  `agent_runtime_protocol`.

## Boundaries

- Depends on: `agent_runtime_protocol`, `agent_fold`, `jev`, `teams`,
  `macro_authorization`.
- Used by: `agent_harness`, `agent_inmem`, `agent_egress`, `agent_trigger`,
  `agent_changes`, `agent_session_realtime`, `ai_tools` (coding-agent
  toolset), `complete_graph`, `graphql_registered_work`, `webhook`,
  `search_service`, `soup_realtime`,
  and the cloud-agent crates (`cursor_cloud_agents`, `codex_cloud_agents`).

## Recipes

- Add a session field: `src/domain/model.rs` → `src/outbound/postgres.rs`
  (migration + query) → `src/inbound/axum_router.rs` (DTO) if exposed over
  HTTP.
- Add a lifecycle transition: `src/domain/lifecycle.rs` → `src/domain/service.rs`
  → `src/outbound/broker_lifecycle_publisher.rs` if it should publish.

## Tool contracts

- `src/inbound/toolset/`: session reads, creation, lifecycle actions, and sharing. Mutations preserve acting-user identity and existing owner/edit receipts; internal controls accept only prompt/stop, never human approvals. `link_task` returns a `mention` chip to paste when naming the task.

`release_session` stops an idle actor silently (`CloseReason::Released`): the
actor refuses with `SessionRelease::Busy` unless its machine is live with no
turn, permission request, elicitation or queued action; otherwise it flushes
buffered frames and stops without the `disconnected` frame, telemetry close or
`session_stopped` callback that every other stop has, and its claim is
released under its fence. Use it only to free memory; a stop anyone should
see goes through `close_session`.

Internal action recovery uses `AgentSessionService::recorded_action`, which reads
one durable log snapshot including pre-load frames. Keep this separate from the
effective history served to transcript readers: replayed prompts lose action IDs.

`domain/notifications.rs` owns durable typed system-event production and the
transaction-aware producer port. `outbound/notifications.rs` owns the outbox
queries and leased batches. Retain unreadable payloads for a delayed retry; a
previously bound action stays whole and returns its identity for runtime
reconciliation, even when this consumer cannot decode its input.
Fresh unreadable rows keep no action identity and do not block valid siblings.
Await rollback on empty or blocked claims so their session lock is released
before the next real prompt attempts to attach quiet events.
Discovery uses bounded cursor pages so callers can
advance past unavailable sessions. Quiet batches bind to the actual prompt action ID;
notification-only turns record `PrompterKind::System` and no human authority.
Never expose notification metadata through public session controls. Notification
sessions read original log frames across load boundaries to retain trusted event
provenance when runtimes echo their prompt history. Queue reads discard legacy
private-context entries; the migration bridge preserves their review outcomes
without restoring owner authority. Claim legacy actions with a conditional
update of only their matching prompter; recover acting identity from that
persisted prompter, never from an old wire actor or a newer user turn.

Archive state lives on `agent_session`: `archived_by`
(`agent_session_archive_cause`: `user`, `pull_request_merged`,
`runtime_closed`; NULL is active) and `archived_at`. A person archiving sets
`user`; restoring clears both. `is_archived` remains only while older replicas
roll out; a trigger mirrors it, and no code may read or write it.

Auto-archive (`domain/auto_archive.rs`, `outbound/postgres/auto_archive.rs`,
`inbound/axum_router/auto_archive.rs`): opt-in triggers (pull requests merged,
runtime deliberately closed). User defaults are columns on
`user_agent_coding_preferences`; per-session overrides are nullable
`agent_session.auto_archive_on_*` columns (NULL follows the owner).
`auto_archive` locks the row and archives only an idle session with no queued
prompts that does not answer a conversation, setting `archived_by` to the
trigger and `auto_archived_at`. `auto_archived_at` is never cleared, even on
restore, so a session auto-archives at most once. A session archives for pull
requests once every linked pull request is closed and at least one merged;
links with no `github_pull_request` row count as open.

Registered work (`domain/work_registration.rs`, `outbound/postgres/work_registration.rs`,
`inbound/axum_router/work_registration.rs`, `inbound/work_registration_sweep.rs`): any account
registers a session it can edit as its work; registering shares nothing, and readers see only
sessions they can view. Rows in `work_registration` end, never delete, and a later turn does
not bring one back. Finished pull requests end them from the pull request consumer regardless
of auto-archive preferences; every archive path ends them in its own transaction, so a new
archive path must call `end_work_registrations_on_archive`; the sweep ends idle and blocked
sessions and catches up on the rest, in one guarded statement that is safe across replicas.
`WorkRegistrationRealtime` wraps a session service's realtime so turn, rename, and archive
changes reach viewers of registered sessions as Soup patches
(`soup_realtime::outbound::agent_sessions::SoupWorkRegistrationSignal`); wrap any new
publisher of list-field changes. GraphQL is `graphql_registered_work`.

Followers: a session started from a thread (`SessionPurpose::visibility`, any
agent) is `hidden`. The harness calls `add_follower` beside `set_turn_prompter`
for a prompt typed into the session itself (`QueuedEntry::direct_prompter`: a
human prompt with no `announce` origin and no trigger `context`), recording an
`agent_session_follower` row; Soup lists hidden sessions for their followers.
Thread mentions, runtime-forwarded triggers, system and bot turns record
nothing. Following never grants access.

Session names: the first prompt names a session (`set_name_if_default`), and
after each turn that ends with a reply, `domain/retitle.rs` hands the
conversation digest to the namer. `name_generation::ClassifiedRetitle` asks Jev
whether the name stopped fitting (threshold 0.8) before Haiku proposes a new
one. Only names with `agent_session.name_is_generated` are retitled; a rename
through `set_name` clears it, so a name a person chose is never replaced.

## Checks

- `cargo test -p agent_session` (`SQLX_OFFLINE` unset).

## Gotchas

- The scheduler's routine-session operations (`domain/routines.rs`,
  `/internal/routine-sessions/*`) also serve routine drafts: `delete` removes
  a session the scheduler opened for its owner, a routine's run (source
  `routine`) or a draft's background session, and refuses any other;
  `activity` returns content-free counts (tool calls, turns).
- A background session (`AgentSession::is_background`, `SessionPurpose::Background`)
  is work the owner asked for that runs out of sight: source `user`, origin
  `requested` by the owner, `hidden`, opened from no message. A routine
  draft's session is one. The harness sends no
  notifications about it, and it is never named or retitled
  (`AdmittedAgentSessionNameGenerator`).

- What opened a session is an `agent_session_source` row, referenced by
  `agent_session.source_id` and written in the transaction that writes the session
  (`outbound/postgres/source.rs`). It holds references only, as
  `trigger_context::TriggerOrigin`. Null means unknown: a session older than this,
  an unclaimed warm session, or an older runtime. It describes a session; `source`
  and `visibility` decide what happens to it (only `is_background` also reads the
  origin), and a runtime's claim never sets them.
  Whoever can view a session reads its origin: `AgentSessionResponse`, the SDK's
  `AgentSession.origin()`, and `ReadAgentSession`.
- Where a session is shown is `agent_session.visibility` (`listed`,
  `unlisted`, `hidden`), set at creation and changed later only by warm
  claims and the DM-context backfill (`list_visibility.rs`).
  `hidden` replaces `list_hidden`. Never read or write
  `list_hidden`: until a later migration drops it, the
  `agent_session_hidden_sync` trigger keeps it in step for replicas on older
  code, and it must keep sorting before `agent_session_legacy_warm_write`
  (triggers fire in name order).

- Whether an in-process session's turns are billed is
  `agent_session.billing` (`SessionBilling`: `billable`, the default, or
  `non_billable`), set at creation from `OpenManagedSession` /
  `PrepareRoutineSession` and read at attach (`session_billing`). A
  non-billable session never claims a warm row, which is billable.
- `ReadAgentSession` bounds its response, not storage work: it folds the full
  effective history like the app. Raw log limits break replay and turn numbering;
  bounded reads need a persisted conversation projection or a fold-aware port.
- The row's fenced log writer and the Cursor projection both lock the
  session row `FOR UPDATE`; never add a second `NOWAIT` locker without
  checking both paths (see git history on `src/domain/control.rs`).
- `modified_at` is Agents/Home list recency. Bump it for user-visible work
  (`moves_session_list`: starting/running/stopping/blocked) and metadata
  the viewer asked to change. Do not bump it for claim, release, recovery,
  ACP session id, or system events (`acp_ready`, `disconnected`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`

- The activity route requires session view access, including for rows affecting other entities; its optional invocation filter stays scoped to the session.
