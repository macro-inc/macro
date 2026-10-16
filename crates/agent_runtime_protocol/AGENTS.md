# agent_runtime_protocol

## What it is

Part of agent sessions: the outer wire protocol every coding-agent
transport (sandboxed containers, in-process, and the Cursor/Codex/Claude
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
  Cursor/Codex/Claude cloud-agent adapter crates.

## Recipes

- Add a new message type: `src/domain/` (schema) → `src/testing/wire_conformance.rs`
  (conformance test) → `src/bin/export_types.rs` if the frontend needs the
  generated type.

## Checks

- `cargo test -p agent_runtime_protocol` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
