# routine_program

## What it is

Routines: the typed program a routine runs. A stored task is
`{"steps": [...], "mcp_servers": [...]}`, the single agent task routines used
before steps (`AgentTask`), which loads as one agent step, or a sub-routine's
copy (`{"sub_routine": "<name>", "inputs": {...}}`), which runs a definition
its parent holds. Pure data and rules; no I/O.

## Start here

- `src/model.rs`: steps (code and agent, a flat list run in order), the
  program's recorded `sdk`, `dangerously_operate_as_user` (code steps write
  as the owner; `CodeIdentity`), its `inputs` and `sub_routines`,
  `AgentTask`, `RoutineTask` (the stored forms, as the scheduler's API
  describes `task`), and `RoutineProgram::from_task`. `code_steps` covers
  the sub-routines' code steps after the routine's own; `code_step_place`
  says where one of them is.
- `src/sub_routine.rs`: `SubRoutineDefinition` (a routine its runs schedule
  copies of: name, title, typed `Input`s without values, steps, apps),
  `SubRoutineCopy` (a copy's task) and `RoutineProgram::copy_program`, the
  program a copy runs: its definition as the parent holds it now, with the
  copy's input values.
- `src/contract.rs`: what a code step receives and returns. `CODE_STEPS`
  (`src/code_steps.md`, how to write a code step: the one description
  CreateRoutine, the scheduler's drafter and the Compose Routines skill read),
  `STEP_CONTEXT` (the type of
  `main`'s argument: `run`, `routine`, `trigger`, `steps`, `knobs`), `code_version`
  (the SDK fingerprint plus a hash of `STEP_CONTEXT`, recorded as `sdk`),
  `assign_step_ids` (ids from titles, on save) and `check_files` (each code
  step's file, with `steps` typed from the code steps before it).
- `src/knob.rs`: `Knob`s, a code step's values its owner changes without new
  code (text, number, boolean, choice, or a question for AI), which `main`
  reads as `knobs.<name>`, typed from the knob but not its value;
  `sentence_slots`, the `{name}` / `{?name}` slots of a step's `sentence`
  (parsed with nom); and `sentence_runs`, that sentence read with its knobs
  as text and values, as a routine suggestion's card shows it.
- `src/plan.rs`: `StepRecord`, what each step of a run did.
- `src/catalog.rs` + `src/catalog/*.ts`: the routine catalog, Macro's checked
  routines: surface, title, trigger (cron without a zone), a code step and/or
  Ask AI instructions, and authored `affects_others`, `safe_default`,
  `template`, `suggest` and `example` marks. The new-routine flow offers
  its templates, the drafter sees the code routines marked `example` as
  worked examples (each lengthens its prompt: run the drafting eval before
  marking one), and suggestions may only pick from it. The harness's real-Deno test type-checks every code step.
- `src/validate.rs`: save-time rules and `limits`, including that every
  knob fits its type and is read by the code, and every sentence slot names
  one of the step's knobs.

## Scope

- Owns: the program's shape, its validation, and the code-step contract.
- Not here: running it → `crates/scheduled_action` (`program_runner.rs`);
  running and type-checking code → `services/agent_harness_service`
  (`routine_code.rs`, over `crates/code_execution`); trigger conditions →
  `scheduled_action`'s `event_runs/condition.rs`.

## Boundaries

- Depends on: `bots` (`AgentMcpServer`).
- Used by: `scheduled_action`, `routines` (agent tools), `system_skills`
  (Compose Routines), and through the
  scheduler's generated clients the SDK (`macro.routines`) and the web app's
  routines editor (`core/routine-steps.ts`).

## Recipes

- Add a limit: `limits` in `src/validate.rs` → its `ProgramError`.
- Add, rename or remove a catalog routine: place it in each routines answer
  key of the suggestions bench (`crates/suggestion_generation/bench/personas/*/routines-truth.json`:
  a need's, a decoy's, `fine` or `misfit`); its `routines` section refuses to
  run until every key places every routine.
- Change what `main` receives: `STEP_CONTEXT` and `code_steps.md` →
  `run_context` in `scheduled_action`'s `program_runner.rs`. The version
  changes with it, so every routine's code is checked again before its next
  run, and rewritten only if that fails.

## Checks

- `cargo test -p routine_program`
- If the task types changed: regenerate the scheduler spec, the web client
  and the SDK (the `schema` feature derives `ToSchema` on every task, step and
  knob type; `scheduled_action`'s `swagger/test.rs` checks `task` is typed).

## Gotchas

- There are no branches: code decides inside itself (`macro.ai.decide`) and
  can branch on anything it has read.
- `sdk` is bookkeeping the scheduler writes after type-checking; never trust a
  client's value (`scheduled_action::domain::code_check`).
- Code steps are checked together: `check_files` appends a module-scoped
  `type StepContext` to each file, after its source so diagnostics keep their
  lines, and a step reads earlier steps' return types by importing their
  files. A change to one step's return can fail a later step.
- A program with `mcp_servers` needs an agent step (`AppsWithoutAgent`).
- A routine's sub-routines are checked with it: their code steps get check
  files numbered after the routine's own, ids unique per run (a definition's
  steps never see the routine's outputs), and every file of a routine with
  sub-routines types `macro.routines.schedule` by their names and inputs,
  with interfaces extending the SDK's types so `macro` stays assignable to
  its `Macro`. A routine without sub-routines types `schedule` as `never`.
  Whether a routine needs checking again compares check files of one build,
  so changing the context's text re-checks no stored routine.
- A copy holds no steps. Editing a definition changes every copy that runs
  after it; a copy whose definition is gone, or whose inputs no longer fit
  it, fails its run (`CopyError`). Keeping a copy as a routine of its own
  first writes out its program (`copy_program`), inputs included.
- `dangerously_operate_as_user` only changes code steps' attribution; agent
  steps keep their agent's. Only the owner sets it: drafts never carry it and
  sharing a routine as a template drops it.
- `RoutineModelId` rejects blank models while parsing, so a single agent task
  with a blank model fails `from_task` rather than validation.
- Only a code routine that affects no one else may be `safe_default` (a
  pre-selected suggestion), and it must run on a workspace-wide event with no
  condition or scope to set up; the catalog tests enforce both. Ask AI acts
  on whatever arrives at run time, so it never qualifies.
- A single agent task keeps the rules it was saved under: `validate()` skips
  the blank and length limits on its instructions, so stored routines keep
  running. Adding steps makes it a program, which gets every limit.
