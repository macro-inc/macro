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
- `src/inbound/axum_router.rs`: the HTTP surface.
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

- Depends on: `agent_runtime_protocol`, `agent_fold` (indirectly via
  callers), `teams`, `macro_authorization`.
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

## Checks

- `cargo test -p agent_session` (`SQLX_OFFLINE` unset).

## Gotchas

- The row's fenced log writer and the Cursor projection both lock the
  session row `FOR UPDATE`; never add a second `NOWAIT` locker without
  checking both paths (see git history on `src/domain/control.rs`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
