# routine_program

## What it is

Routines: the typed program a routine runs. A stored task is either
`{"steps": [...], "mcp_servers": [...]}` or the single agent task routines used
before steps (`AgentTask`), which loads as one agent step. Pure data and rules;
no I/O.

## Start here

- `src/model.rs`: steps (tool, if, choose, agent), `RoutineTool` (the only tools
  a step may call), `AgentTask`, and `RoutineProgram::from_task`.
- `src/plan.rs`: `questions()` (every decision, untaken branches included, for
  one classifier call) and `resolve()` (answers → the steps to run).
- `src/validate.rs`: save-time rules and `limits`.
- `src/template.rs`: `{{trigger.…}}` / `{{steps.<id>.…}}` placeholders.

## Scope

- Owns: the program's shape, its validation, decision planning and argument
  rendering.
- Not here: running it → `crates/scheduled_action` (`program_runner.rs`);
  calling tools → `services/agent_harness_service` (`routine_tools.rs`);
  answering questions → `crates/jev`.

## Boundaries

- Depends on: `jev` (question type), `bots` (`AgentMcpServer`).
- Used by: `scheduled_action`, `routines` (agent tools), the web app's
  routines editor, which mirrors the wire shape in `core/routine-steps.ts`.

## Recipes

- Allow a step to call another tool: `RoutineTool` in `src/model.rs` →
  the web catalog `apps/web/src/features/routines/core/step-catalog.ts` →
  `crates/routines/src/create_routine.md`.
- Add a limit: `limits` in `src/validate.rs` → its `ProgramError`.

## Checks

- `cargo test -p routine_program`
- If the task types changed: regenerate the scheduler spec and SDK (the `schema`
  feature registers `AgentTask`, `AgentTaskAgent` and `RoutineModelId`).

## Gotchas

- Tool outputs never change which steps run; every decision is answered before
  the first step, so a branch can't depend on an earlier tool's result.
- `resolve()` consumes answers for untaken branches too; keep `questions()` and
  `resolve()` walking the tree in the same order.
- A program with `mcp_servers` needs an agent step (`AppsWithoutAgent`).
- `RoutineModelId` rejects blank models while parsing, so a single agent task
  with a blank model fails `from_task` rather than validation.
