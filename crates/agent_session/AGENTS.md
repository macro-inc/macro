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

- Depends on: `agent_runtime_protocol`, `agent_fold`, `teams`,
  `macro_authorization`.
- Used by: `agent_harness`, `agent_inmem`, `agent_egress`, `agent_trigger`,
  `agent_changes`, `agent_session_realtime`, `ai_tools` (coding-agent
  toolset), `complete_graph`, `webhook`, `search_service`, `soup_realtime`,
  and the cloud-agent crates (`cursor_cloud_agents`, `codex_cloud_agents`).

## Recipes

- Add a session field: `src/domain/model.rs` → `src/outbound/postgres.rs`
  (migration + query) → `src/inbound/axum_router.rs` (DTO) if exposed over
  HTTP.
- Add a lifecycle transition: `src/domain/lifecycle.rs` → `src/domain/service.rs`
  → `src/outbound/broker_lifecycle_publisher.rs` if it should publish.

## Tool contracts

- `src/inbound/toolset/`: session reads, creation, lifecycle actions, and sharing. Mutations preserve acting-user identity and existing owner/edit receipts; internal controls accept only prompt/stop, never human approvals.

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

## Checks

- `cargo test -p agent_session` (`SQLX_OFFLINE` unset).

## Gotchas

- Where a session is shown is `agent_session.visibility` (`listed`,
  `unlisted`, `hidden`); `hidden` replaces `list_hidden`. Never read or write
  `list_hidden`: until a later migration drops it, the
  `agent_session_hidden_sync` trigger keeps it in step for replicas on older
  code, and it must keep sorting before `agent_session_legacy_warm_write`
  (triggers fire in name order).

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
