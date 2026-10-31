# routines

## What it is

Part of the agent sessions feature. Validated routine (scheduled-action)
commands and AI tools for agents to schedule themselves or another
persona/model to run later.

## Start here

- `src/domain.rs`: `RoutineConfiguration` — name, `triggers`
  (`RoutineTrigger`: `Once`, `Cron` or activity `Event`s) and `steps` (a
  [`routine_program`](../routine_program/AGENTS.md) program, sent as a JSON
  string) — the validated command shape. `deserialize_configuration` still
  accepts the old single-agent input (`instructions`, `target`, `schedule`)
  and turns it into one agent step.
- `src/inbound.rs`: the AI toolset exposed to MCP and embedded agents.
- `src/create_routine.md`: `CreateRoutine`'s description — the step types,
  allowed tools and placeholders agents compose routines from.
- `CreateRoutine` tells agents to use `m-document-mention` with the routine ID,
  name, and `blockName: "routine"` in replies.
- `src/outbound.rs`: the HTTP client to the owning scheduled-action service.

## Scope

- Owns: routine command validation and the agent-facing tools to create/manage
  them.
- Not here: the cron engine and durable schedule storage, owned by the
  scheduled-action service this crate's `outbound` calls into.

## Boundaries

- Depends on: `ai_toolset`, `macro_authorization`, `macro_user_id`,
  `routine_program` (the step model and its validation).
- Used by: `ai_tools`.

## Recipes

- Add a routine tool: `src/domain.rs` (command/schema) → `src/outbound.rs`
  (HTTP call) → `src/inbound.rs` (tool registration).

## Checks

- `cargo test -p routines` (`SQLX_OFFLINE` unset).

## Related

- Skill: `create-ai-tool` · Rules: `.agents/rules/rust/architecture.md`
