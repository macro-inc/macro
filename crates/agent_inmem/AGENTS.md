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

Native user tools bypass the ordinary gate only when the final-draft review
finisher is installed; otherwise dispatch must resolve their actor normally.

Session tool schemas require `acting_as: requester | owner` for tools using
account access, including deferred tools. The gate resolves the selected account
through `TurnPrompter::acting_user()` and requests owner approval only when that
account differs from the turn's requester. System invocations have no requester.
Reviewed user tools retain the selection through confirmation and execute with
that account. Billing, memory, and session lifecycle remain owner-scoped. Model-context replay
retains notification ACP inputs and their replies; the transcript fold separately
omits system input from its message projection. PresentReview, GetReview and
DecideReview are eager internal tools in both standard and code modes.

## Checks

- `cargo test -p agent_inmem` (`SQLX_OFFLINE` unset).

## Gotchas

- `auto` is a picker entry, not a routable id: `RigTurnEngine` asks its
  `AutoModelSelector` (Jev through cognition's named decisions, 1 s budget) per turn and runs
  Opus 5.5 (hard), GPT-6.1 Sol (mid) or Gemini 3.8 Flash (simple, and
  whenever Jev is unavailable). Capability lookups go through
  `models::resolve`.
- Keep session-aware `NameSearch`, `ContentSearch`, and `ListEntities` native in
  code mode; legacy `ReadChat` must not appear in either runtime tool catalog.
- Replay tool calls using `_meta.macro.toolName`; ACP titles may be human-readable
  MCP labels, so only use the title for older frames without tool-name metadata.

## Related

- Rules: `.agents/rules/rust/architecture.md`
