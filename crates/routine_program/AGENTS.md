# routine_program

## What it is

Routines: the typed program a routine runs. A stored task is either
`{"steps": [...], "mcp_servers": [...]}` or the single agent task routines used
before steps (`AgentTask`), which loads as one agent step. Pure data and rules;
no I/O.

## Start here

- `src/model.rs`: steps (code, tool, if, choose, agent), `RoutineTool` (the
  only tools a tool step may call), `WriteScope` (the areas a code step may
  change), the program's recorded `sdk`, `AgentTask`, and
  `RoutineProgram::from_task`.
- `src/contract.rs`: what a code step receives and returns. `CODE_STEPS`
  (`src/code_steps.md`, how to write a code step: the one description
  CreateRoutine and the web drafter both read), `STEP_CONTEXT` (the type of
  `main`'s argument: `run`, `routine`, `trigger`, `steps`), `code_version`
  (the SDK fingerprint plus a hash of `STEP_CONTEXT`, recorded as `sdk`),
  `assign_step_ids` (ids from titles, on save) and `check_files` (each code
  step's file, with `steps` typed from the steps that always run before it).
- `src/plan.rs`: `questions()` (every decision, untaken branches included, for
  one classifier call) and `resolve()` (answers → the steps to run).
- `src/validate.rs`: save-time rules and `limits`.
- `src/template.rs`: `{{trigger.…}}` / `{{steps.<id>.…}}` placeholders.

## Scope

- Owns: the program's shape, its validation, decision planning and argument
  rendering.
- Not here: running it → `crates/scheduled_action` (`program_runner.rs`);
  calling tools → `services/agent_harness_service` (`routine_tools.rs`);
  running and type-checking code → `services/agent_harness_service`
  (`routine_code.rs`, over `crates/code_execution`); answering questions →
  `crates/jev`.

## Boundaries

- Depends on: `jev` (question type), `bots` (`AgentMcpServer`).
- Used by: `scheduled_action`, `routines` (agent tools), the web app's
  routines editor, which mirrors the wire shape in `core/routine-steps.ts`.

## Recipes

- Allow a step to call another tool: `RoutineTool` in `src/model.rs` →
  the web catalog `apps/web/src/features/routines/core/step-catalog.ts` →
  `crates/routines/src/create_routine.md`.
- Add a limit: `limits` in `src/validate.rs` → its `ProgramError`.
- Change what `main` receives: `STEP_CONTEXT` and `code_steps.md` →
  `run_context` in `scheduled_action`'s `program_runner.rs`. The version
  changes with it, so every routine's code is checked again before its next
  run, and rewritten only if that fails.
- Type a tool's output for code: `RoutineToolOutputs` in `STEP_CONTEXT`.

## Checks

- `cargo test -p routine_program`
- If the task types changed: regenerate the scheduler spec and SDK (the `schema`
  feature registers `AgentTask`, `AgentTaskAgent` and `RoutineModelId`).

## Gotchas

- Tool outputs never change which steps run; every decision is answered before
  the first step, so a branch can't depend on an earlier tool's result. Code
  can branch on anything inside itself.
- `sdk` is bookkeeping the scheduler writes after type-checking; never trust a
  client's value (`scheduled_action::domain::code_check`).
- Code steps are checked together: `check_files` appends a module-scoped
  `type StepContext` to each file, after its source so diagnostics keep their
  lines, and a step reads earlier steps' return types by importing their
  files. A change to one step's return can fail a later step.
- `resolve()` consumes answers for untaken branches too; keep `questions()` and
  `resolve()` walking the tree in the same order.
- A program with `mcp_servers` needs an agent step (`AppsWithoutAgent`).
- `RoutineModelId` rejects blank models while parsing, so a single agent task
  with a blank model fails `from_task` rather than validation.
- A single agent task keeps the rules it was saved under: `validate()` skips
  the blank and length limits on its instructions, so stored routines keep
  running. Adding steps makes it a program, which gets every limit.
