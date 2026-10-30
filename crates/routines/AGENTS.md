# routines

## What it is

Part of the agent sessions feature. Validated routine (scheduled-action)
commands and AI tools for agents to schedule themselves or another
persona/model to run later.

## Start here

- `src/domain.rs`: `RoutineTarget` (model vs. agent persona) and
  `RoutineSchedule` (`Once` / `Cron`) — the validated command shapes.
- `src/inbound.rs`: the AI toolset exposed to MCP and embedded agents.
- `CreateRoutine` tells agents to use `m-document-mention` with the routine ID,
  name, and `blockName: "routine"` in replies.
- `src/outbound.rs`: the HTTP client to the owning scheduled-action service.

## Scope

- Owns: routine command validation and the agent-facing tools to create/manage
  them.
- Not here: the cron engine and durable schedule storage, owned by the
  scheduled-action service this crate's `outbound` calls into.

## Boundaries

- Depends on: `ai_toolset`, `macro_authorization`, `macro_user_id`.
- Used by: `ai_tools`.

## Recipes

- Add a routine tool: `src/domain.rs` (command/schema) → `src/outbound.rs`
  (HTTP call) → `src/inbound.rs` (tool registration).

## Checks

- `cargo test -p routines` (`SQLX_OFFLINE` unset).

## Related

- Skill: `create-ai-tool` · Rules: `.agents/rules/rust/architecture.md`
