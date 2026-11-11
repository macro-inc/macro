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
  `teardown` drops a session's conversation, agent task and token; the
  harness calls it on delete and when it releases an idle session, and the
  next `attach` rebuilds the conversation from the log (`rebuilt_state`).
  `rebuilds_identically` gates the idle release: the rebuilt model context
  (history without reasoning parts and with adjacent text merged, as
  `agent::to_rig_messages` builds it; model, effort, speed, identity,
  instructions) must equal the live one, with no summary in flight, failed, or
  image descriptions cached, since none of that is in the log. A replay change
  that drifts from the live history stops sessions from releasing; the
  manager tests with MCP calls and a failed turn guard it.
- `src/domain/tool_stream.rs`: throttled, bounded argument previews for pending
  calls; replay ignores previews and retains only calls that began execution.
- `src/domain/session.rs` / `src/domain/replay.rs`: in-process session state
  and log replay on reconnect.
- `src/domain/admission.rs` + `src/outbound/approval_gate.rs`: usage/plan
  admission and tool-approval gating for in-memory sessions. Turns admit and
  meter as the session's feature (`AgentState::feature`, from
  `SessionFacts::billing` via `session_feature`): `AgentSession`, or
  `NonBillableAgentSession` when the opener set `SessionBilling::NonBillable`.
  Every usage row a turn records carries the session id
  (`ai_usage.agent_session_id`); its tools record through
  `ai_usage::for_agent_session`.
- `src/domain/model_access.rs` (`SessionModels`) and `AgentState::turn_agent_key`:
  an agent with its own usable API key (`agent_api_keys`) runs every turn on
  it without admission, and its session offers only that provider's models.

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

- Owner memory is composed by the memory domain on each read; daily generation is hosted by cognition, not agent turns.

## Checks

- `cargo test -p agent_inmem` (`SQLX_OFFLINE` unset).

## Gotchas

- Owners with `auto-skills` (`domain::entity_routing`) route SDK entities on
  code-mode turns: the prompt is `routed_prompt` (no area guidance) and the
  entities `select_documentation` picks bring their `@agent` guide with their
  index into the turn part. Everyone else keeps `prompt`, which inlines every
  guide.
- `auto` is a picker entry, not a routable id: `RigTurnEngine` asks its
  `AutoModelSelector` (Jev through cognition's named decisions, 1 s budget) per turn and runs
  Opus 5.5 (hard), GPT-6.1 Sol (mid) or Gemini 3.8 Flash (simple, and
  whenever Jev is unavailable). Capability lookups go through
  `models::resolve`.
- Owners with the `auto-skills` flag route each turn's request to their skills
  (`skills::domain::selection`, Jev, 1 s). Loaded skills are appended to the
  user message that loaded them in the model's copy only, and remembered per
  session in `SessionSkills` (memory; lost on restart). Eval:
  `route_evaluation` (ignored; needs `TYPESAFE_API_KEY`).
- Keep session-aware `NameSearch`, `ContentSearch`, and `ListEntities` native in
  code mode; legacy `ReadChat` must not appear in either runtime tool catalog.
- Every turn cuts tool results over `agent::ToolResultLimit`'s limit (about
  25k tokens) for the model and offers `ReadToolResult` to page through them.
  The stream, log and history keep the whole result; replay cuts it again, so
  build turn messages with `to_rig_messages_limited`, not `to_rig_messages`.
- `rig_engine::system_prompt` orders text from most to least stable for the
  prompt cache: the static Macro prompt (the cached shared block, the same for
  every agent), then the session's part, then the turn's (`with_turn`). Put
  anything that changes per turn in the turn part, never in the shared block;
  measure with `measure_prompt_cache_turns`.
- Replay tool calls using `_meta.macro.toolName`; ACP titles may be human-readable
  MCP labels, so only use the title for older frames without tool-name metadata.
  An MCP tool's `mcp__<server>__<tool>` name rebuilds as the `McpToolCall` the
  live agent recorded (split by `mcp_toolset::unmangle`, the title as its
  display name when it differs), and its result keeps the mangled name. A
  failed turn's last text chunk is the failure reply the live history never
  held; replay strips it and keeps the turn.

## Related

- Rules: `.agents/rules/rust/architecture.md`
