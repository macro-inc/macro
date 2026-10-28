# agent_runtime_protocol

## What it is

Part of agent sessions: the outer wire protocol every coding-agent
transport (sandboxed containers, in-process, and the Cursor/Codex
cloud-agent adapters) speaks — carries Agent Client Protocol (ACP) payloads
plus runtime control messages without interpreting the wrapped ACP
payloads.

## Start here

- `src/domain/connection.rs`: role-oriented connections (host vs. runtime
  side of the wire).
- `src/domain/turn.rs` / `src/domain/action.rs`: turn and action framing.
- `src/domain/tool_approval.rs`: the approval message shapes used by owner
  approval flows.
- `src/domain/ports.rs`: the transport-agnostic wire port.
- `src/outbound/websocket.rs`: the WebSocket transport adapter (behind the
  `transport` feature).
- `src/testing/wire_conformance.rs`: shared conformance tests for any new
  transport.

## Scope

- Owns: the protocol schema and the role-oriented wire port; nothing about
  how a session is provisioned or stored.
- Not here: session lifecycle/state → `agent_session`; container/runtime
  orchestration → `agent_harness`, `agent_inmem`.

## Boundaries

- Depends on: nothing crate-specific (foundational protocol crate).
- Used by: `agent_session`, `agent_session_realtime`, `agent_harness`,
  `agent_egress`, `agent_inmem`, `webhook`, `complete_graph`, and the
  Cursor/Codex cloud-agent adapter crates.

## Recipes

- Add a new message type: `src/domain/` (schema) → `src/testing/wire_conformance.rs`
  (conformance test) → `src/bin/export_types.rs` if the frontend needs the
  generated type.

`domain/notification.rs` owns typed system events and their ACP metadata/XML.
Notification-only invocations use `AgentAction::notification`; public control must
reject caller-supplied notification metadata. Payloads contain facts, not drafts.
The fold reuses this tagged event enum for its generated TypeScript union;
retain Specta derives on event payloads and preserve the producer wire shape.
Allow exact `<noop/>` only before any tool call in a notification turn; prompt
instructions must match the fold's conservative treatment of all tool activity.

UUID prompt actions append their action ID in hidden invocation context for
ExecuteCode stale-turn fencing; mark that block with `INVOCATION_CONTEXT_META`
so the transcript fold omits it. Preserve existing prompt content and notification
metadata; compaction must remain the single `/compact` block.

## Checks

- `cargo test -p agent_runtime_protocol` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
