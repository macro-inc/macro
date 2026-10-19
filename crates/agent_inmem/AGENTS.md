# agent_inmem

## What it is

Part of agent sessions: the lightweight alternative to `agent_harness`'s
sandboxed containers — serves the agent side of ACP in-process, running
the same agentic loop behind the same ACP contract, so a session starts in
milliseconds instead of waiting on container provisioning.

## Start here

- `src/rig_engine.rs`: `RigTurnEngine` — the production composition root,
  runs one turn over `agent::AgentLoop` and the Macro toolset.
- `src/domain/engine.rs`: `TurnEngine` port — the seam `rig_engine` fills.
- `src/outbound/manager.rs`: `InMemAgentManager` — provisions per-session
  agent tasks, implements the container-manager port the harness expects.
- `src/domain/session.rs` / `src/domain/replay.rs`: in-process session state
  and log replay on reconnect.
- `src/domain/admission.rs` + `src/outbound/approval_gate.rs`: usage/plan
  admission and tool-approval gating for in-memory sessions.

## Scope

- Owns: running the agentic loop in-process behind the same ACP contract as
  the sandboxed harness, so session log/fold/UI code is runtime-agnostic.
- Not here: sandboxed container sessions → `agent_harness`; the ACP wire
  shapes themselves → `agent_runtime_protocol`.

## Boundaries

- Depends on: `agent` (the turn loop), `ai_toolset`, `agent_egress`
  (`egress_mcp.rs`), `ai_billing`, `ai_usage`.
- Used by: `agent_harness_service` (its sole host, alongside
  `agent_harness` for sandboxed sessions).

## Recipes

- Add compaction/summarization behavior: `src/domain/engine.rs` →
  `src/rig_engine.rs`.
- Add a new tool gate or admission check: `src/domain/tool_gate.rs` /
  `src/domain/admission.rs` → `src/outbound/approval_gate.rs`.

## Checks

- `cargo test -p agent_inmem` (`SQLX_OFFLINE` unset).

## Gotchas

- Replay tool calls using `_meta.macro.toolName`; ACP titles may be human-readable
  MCP labels, so only use the title for older frames without tool-name metadata.

## Related

- Rules: `.agents/rules/rust/architecture.md`
