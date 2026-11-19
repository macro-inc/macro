## Why

A routine that schedules the same follow-up for each item it handles (a
reminder for each task coming due, a check-back for each request) writes a
whole new routine on every run today: each sub-routine carries its own copy
of the steps, written and type-checked inside the run, and changing what the
follow-up does means changing every pending one. The follow-ups are
identical; only when each runs and which item it is about differ.

## How it works

The routine defines the follow-up once, in its program, with named inputs,
and it is checked when the routine is saved. A run schedules copies of it
with a trigger and values for the inputs. A copy stores only which
definition it runs and its values. When a copy runs, the scheduler reads the
definition from the parent as it is then, so an edit to the definition
reaches every copy that hasn't run.

```
parent task                                   copy task (one per item)
{ steps: [ code: find what is due,            { sub_routine: "remind",
    macro.routines.schedule('remind', {         inputs: { taskId: "..." } }
      trigger: { type: 'once', at },          trigger: once, at the due time
      inputs: { taskId }, key }) ],
  sub_routines: [ { name: "remind",           when it runs:
      title: "Remind me",                       parent.sub_routines["remind"].steps
      inputs: [ text taskId ],                  + inputs (code: `inputs.taskId`,
      steps: [ ... ] } ] }                        Ask AI: a data block)
```

The parent's code is type-checked with `macro.routines.schedule` taking,
for each definition, its name and that definition's inputs (one argument
list per name, so a name chosen at run time can't pass another
definition's inputs), and each definition's code with its typed `inputs`.
A direct call naming a missing sub-routine or a wrong input fails the save
rather than a run. The SDK itself types the name as `SubRoutineName`,
which is `never`: only a routine's check gives it names. So in a routine
without definitions, and in a helper typed with the SDK's `Macro` in any
routine, no call to `schedule` passes the check, and the MCP tools leave it
out. The step context is main's, unchanged, and a routine without
definitions gets main's check file byte for byte, so its `macro` is the
SDK's `Macro` both ways round; in a routine with definitions it is an
intersection with `Macro`, so helpers typed with `Macro` still take it.
The scheduler checks the name and inputs again when `schedule` is called;
inputs passed through a variable can carry an extra field the type check
lets through (TypeScript's types are structural), which it refuses then.

## What

- `routine_program`: `SubRoutineDefinition` (name, title, typed `Input`s
  without values, steps, apps), program-level `inputs` (a detached copy
  keeps its values there), `SubRoutineCopy` (a copy's task) and
  `RoutineProgram::copy_program`, the program a copy runs. Validation: at
  most 5 definitions with unique names, each a valid step list, at most 12
  inputs with unique names. No text anywhere in a saved task can hold a NUL
  (`InvalidProgram(Nul)`), which Postgres can't store and whose refusal
  would quote the text beside it into a logged error. The checker takes at
  most 40 files, one per code step: a parent's check holds its own code
  steps and every definition's, and a copy made standalone holds its
  definition's beside all the definitions it inherits. So the definitions'
  code steps, plus the routine's own or its largest definition's,
  whichever has more, can be at most 40 (`TooManyCodeSteps`); a routine
  without definitions keeps the checker's limit as it was. `code_steps`
  covers definitions' code steps after the routine's own. Check files type
  `schedule` as above, as an overload intersected with the SDK's types
  (an interface extending them couldn't override a method whose name is
  `never`, and `Omit` would drop their private members and break assignability to
  `Macro`), and `inputs` only for a routine or sub-routine that declares
  some, so a copy made standalone checks as it did. A routine with neither
  gets main's per-file line exactly, so no stored routine's check file
  grows toward the checker's 64 KiB limit. A routine's code version is the
  SDK's fingerprint with a hash of the step context. Only the SDK's
  changes here (it gains `schedule`, and `RoutineTask`, a routine's
  `detail.task`, gains the copy's shape), so every stored routine with
  code is checked once more after the deploy, as after any SDK release,
  wherever code is checked (at the harness's startup for enabled routines,
  when a run that runs code starts, or when one is saved; the deploy steps
  give the exceptions). Code that branches two ways on a routine's task
  (`'steps' in task ? … : task.prompt`) fails that check, since a copy's
  task has neither; see the deploy steps. The step
  context stays main's on purpose: narrowing `macro` there would fail
  stored code that hands a `Macro` back as a `StepContext` on that check,
  and the upgrade pauses a routine whose code fails it when it can't be
  rewritten. While both builds serve, each stamps a routine it
  checks with its own SDK, so a routine whose code suits both can be
  checked and stamped back and forth until the rollout ends; each check
  passes and leaves the code as it is.
- `scheduled_action`:
  - `POST /scheduled-actions/schedule` (`ScheduleSubRoutine`: `subRoutine`,
    trigger, inputs, and an optional display `name` and `key`, camelCase
    like the other request bodies, so `sub_routine` there is refused as an
    unknown field; `inputs` may be left out for a
    definition that declares none, and a blank name counts as none) makes a copy under the running routine
    through the existing sub-routine create: only a run's credential can,
    the cap of 50 active sub-routines holds for a new copy, a key upserts
    (as for keyed sub-routines on main, giving a one-time copy that already
    fired a new time under its key brings it back even at the cap, while
    sending its consumed time leaves it finished; a key an ordinary
    sub-routine holds is
    refused with `CopyTaskFixed`), and copies pause and delete with the
    parent. Its OpenAPI lists every status the handler returns: 403 for a
    request that doesn't come from a routine's run, 404 for a parent
    deleted mid-run, 409 for the cap, a key an ordinary sub-routine holds,
    or a keyed copy that changed or is running, 413 for an oversized
    body, and 400 for a malformed request or trigger, an unknown
    definition, inputs that don't fit, or the flag off. Kind and run visibility come from the
    parent; the name defaults to the definition's title. Span
    `routine.schedule` records the parent and run as soon as the run is
    known, before any refusal, keyed, input count and outcome (`created`,
    `updated`, a `refused_*` naming the scheduling check that refused it:
    cap, outside a run, rollout, definition, key or text; any other error,
    a key an ordinary sub-routine holds included, is `failed`), never
    values. The run that executes a sub-routine records its parent and the
    run that made it under the same field names (`routine.execute`, on
    the clock-driven and manual path and, with `trigger = event`, the
    event path), so a copy that fires a day later on another replica is
    found from the run that scheduled it. No trace context crosses that
    hop: the copy is a row that fires later, and the ids are the link, as
    for the children a run's code creates on main (#10238), which carry the
    same two ids and no trace either. Storing the creating span's
    `traceparent` on linked rows, for both, is a follow-up.
    `created_by_run_id` is the run that first made the copy; every
    `routine.schedule` that made or moved it records it as `routine.id`,
    so a keyed reschedule is found from the copy's `action_id`. Reading
    its definition from the parent and resolving it with the copy's inputs
    is its own span (`routine.copy.read_definition`), whose `outcome` is
    `resolved`, `parent_missing`, `read_failed` or
    `definition_failed`, or `interrupted` when the run's cancellation or
    deadline cuts the read short (the run's record says which). On the
    event path, a claimed firing is one `routine.event_run` span with the
    routine and event ids (an event the rollout cancels or a condition
    skips is never claimed and has none); under it, `routine.execute`
    records how the run ended (`succeeded`, `failed`, or `interrupted`
    when the worker stops mid-run), as it now does on the clock-driven and
    manual path too (a refused claim or a failed firing write is `failed`,
    and a run dropped before it ends is `interrupted`), and
    `routine.event_run.finalize`, the write that records the run, ends
    `finalized`, `already_finalized`, `stale_claim` or `failed`. For this
    route's own refusals, its error event (CS-22) and the response never
    repeat what the caller sent: an unknown definition or input, or a
    key, name or trigger the handler finds malformed, gets a fixed message,
    and the run ids and outcome are what an operator searches by. A body
    that doesn't parse as the request, a cron expression that doesn't parse
    among them, is rejected by axum's JSON extractor before the handler,
    whose message names the part it couldn't read (for a cron, the
    expression), as on every route. A key,
    name or trigger holding a NUL is refused before the keyed lookup or the
    write (`InvalidKey`, `ScheduledTextNul`, 400).
  - Runs: `prepare` loads a copy's parent once (it replaces the parent read
    the run notification already made; a failed read is tried once more
    for the notification's name) and `ExecutionHandle::program`
    builds the program from it. A copy's agent and apps are checked when its
    parent is saved, so `prepare` admits a copy's first agent, wherever it
    sits, before any of its code acts. Code reads the values as `inputs`; an
    Ask AI step gets them after its instructions as data, not instructions.
    A copy whose parent is gone fails in `prepare`; one whose definition is
    gone or whose inputs no longer fit fails its run.
  - Picked items (entity knobs): saving, checking or resuming a parent
    checks its definitions' knobs with its own, and a copy's step checks
    its definition's when it starts, as any run does. A copy whose item is
    gone says to pick another in its parent routine's sub-routine, since
    the copy's own page shows its steps read-only.
    `GET /scheduled-actions/{id}/unusable-items` lists definitions' knobs
    too, each with `sub_routine` naming its definition (absent for the
    routine's own), since step ids are unique only among the steps they run
    with.
  - Guards:
    - Every write whose task gains definitions, program inputs or a copy's
      reference waits on the flag: create, keyed upsert, update,
      replacement, and scheduling. A schedule call is refused earlier when
      it comes from outside a run, or its key, name or inputs don't fit;
      one that fits reaches the flag before anything is written. Scheduling
      reads the sub-routine flag once: a copy's task changes only through
      scheduling, so the create or keyed update it leads to doesn't read it
      again. (Event management reads its own flag as before, so a keyed
      reschedule onto an event trigger loads flags more than once; the test
      counts the sub-routine check, not PostHog requests.)
    - A new or changed task without steps is read as the single agent,
      whose parser skips unknown fields, so any `sub_routines`, `inputs` or
      `sub_routine` beside it would be saved unchecked: they are dropped
      before saving. No client writes those fields on such a task, but
      main's parser kept them, so a stored one is left alone: it runs as
      before (a stray `sub_routine` beside an agent's fields doesn't make it
      a copy, here or in the web, which reads a task as a copy only when it
      holds nothing but `sub_routine` and `inputs`), and an update whose
      task is the stored one less those fields (renaming, pausing or
      resuming it) keeps the stored task as it is, empty lists included. Changing its task saves
      it without them. Only a task with steps defines sub-routines for any
      check, so a keyed repeat of a create, an edit of a routine a run
      made, and the apps guard all ignore such fields as the save does;
      `git grep` finds no client that ever wrote them.
    - Making an existing copy standalone doesn't wait on the flag, so
      switching the flag off strands no copy; the standalone routine gets
      the copy's input values and its parent's definitions, and runs that
      schedule copies later do so under it. Empty `sub_routines` and
      `inputs` arrays are dropped before saving, so an older build, which
      refuses unknown fields, still reads the routine.
    - Only scheduling makes a copy: a create outside a run can't name a
      definition (`CopyOutsideRun`, 400), and an update can't turn a task
      into a copy or change a copy's task (`CopyTaskFixed`, 409). A routine
      a run created defines no sub-routines (`NestedSubRoutines`, 400), so a
      name a run schedules always means its top-level parent's definition.
    - An update that omits a non-empty `sub_routines` or `inputs` is
      refused (`ExplicitSubRoutinesRequired`, 409), as steps and apps
      already are. So is one that sends back a definition that has apps
      without its `mcp_servers` (`ExplicitAppsRequired`): the SDK of the
      next change in this stack sends definitions but can't hold their
      apps, so an update through it would otherwise save the definition
      without them. The SDK here sends no definitions, which the rule above
      already refuses. An empty list clears them, and leaving the
      definition out removes it.
    - A copy never writes as its owner, whatever its parent does: a run
      chose its values and no person reviewed them.
    - Agent sessions held to a scope that sends nothing can't schedule.
  - Check places a failing step inside its definition
    (`CheckedStepProblems.sub_routine`). Target validation covers
    definitions' agents and apps when the parent is saved; a copy's are
    checked through its parent then and on every run, so saving, resuming
    or scheduling a copy doesn't check them again. One validation reads the
    owner's connected apps at most once, on the first selection that needs
    them, and hands that list to its other selections; the next validation
    or run reads it again, so a disconnection is seen there. The check of
    the apps a draft's session names as missing leaves out the ones the
    routine already requires, a definition's included, since saving checks
    those with the routine's own.
    Configuration (`SchedulerConfig`) and the replacement and sub-routine
    policy moved out of `domain/service.rs` unchanged, the schedule route
    out of the router, and the copy cases out of the test files they would
    have grown. Files main already had over the ~1,000-line rule grow
    here by 2 to 55 lines each, and `service.rs` shrinks by 77: the
    tests `service/test.rs` (+55), `execution/test.rs` (+32),
    `axum_router/test.rs` (+27) and the harness's `routine_code/test.rs`
    (+2), in fakes and fixtures; `ports.rs` (+40) for the new ports'
    methods; `axum_router.rs` (+16) and the harness's `scheduling.rs`
    (+7) for wiring. Splitting main's files is left to a change of its
    own.
  - Keeping a copy as its own routine writes its definition as the parent
    holds it now, with the copy's values, and clears its link in one
    transaction (`detach_copy`). A copy whose definition changed since its
    last run keeps the current steps, which are what its next run would
    have used. The dispatch slot is reserved before that write, as delete
    does, so a stopped dispatcher fails the request with the copy still a
    copy, and a retry detaches it. In the transaction the
    revision-checked write locks the row, its returned parent must still be
    the copy's parent, and the unlink is by primary key. The sources Macro
    wrote in its parent's upgrades that its steps hold go to the new
    `scheduled_action_inherited_rewrite`, which the rule against writing as
    the owner over a model rewrite reads beside the routine's own upgrades.
    A detach that retains no code, in its steps or in the definitions it
    inherits, skips that read of its parent's upgrades. Its own
    upgrade history starts empty, so its upgrades can claim any SDK. Detach
    still needs the copy's definition and values to fit, and checks the
    result as any edit: a removed definition or failing code refuses it.
    The checker names files by step number, so a definition's steps get
    longer names once they follow the parent's (`step_2.ts` can become
    `step_11.ts`), and a file within a few bytes of the checker's 64 KiB
    limit can pass in the parent and fail after detach. Detach is then
    refused with the checker's size error and the copy keeps running as a
    copy; reserving that margin in every parent's check would refuse
    routines that run today.
  - Keyed copies are found by parent and key as one value, held only by the
    new unique partial index `scheduled_action_child_ref_idx`, so stale
    statistics on a parent with many children can't choose an index that
    reads them all. A create refused by either unique index on the pair is
    the same lost race.
  - Code upgrade: a copy's code is brought up as its parent's. A run whose
    own steps run no code skips the upgrade, so an agent-only parent whose
    code is only in its definitions, and an agent-only copy, skip the code
    path and its time-zone read. A failed rewrite pauses the routine and
    every enabled active sub-routine under it, ordinary sub-routines and
    agent-only copies included, only when its own steps run code; otherwise
    its copies wait for the owner's update and the routine keeps running.
    A routine's code carries one SDK stamp for its own steps and its
    definitions, so a parent whose own code checks still pauses, with all
    its sub-routines, when only a definition's code fails to rewrite: the
    copies of that definition would fail on its code anyway, the others
    pause with them, and pausing per definition needs a stamp per
    definition. A rewrite holding a NUL is dropped rather than stored as
    the proposal, which Postgres would refuse, undoing the pause; reasons
    lose any NUL too. The sweep, once per harness startup, finds code in
    definitions too and walks the primary key in batches of 1,000 (span
    `routine.code_sweep.batch` each, with where it starts, how many it
    upgraded or left waiting, and an outcome of completed, cancelled or
    failed, recorded on every exit; the sweep's span sums them). Its dry
    run gets the program's input values; rewritten definition steps aren't
    dry-run, as a copy's values exist only in each copy.
  - Sharing a copy as a template is refused: its steps are its parent's,
    so the template would hold none. So is sharing a routine with
    definitions or input values: activation offers to swap the workspace
    items a template's own steps mention, and doesn't yet walk
    definitions or values.
- `routines` (the routine AI tools): a parent with definitions or inputs,
  and a copy, read as not editable here, since the tools can't state either.
- SDK: `macro.routines.schedule(subRoutine, { trigger, inputs, key, name })`.
  It ships here because the check types a parent's code against the SDK's
  `schedule`. Generated clients, specs and the sdk-mcp snapshots are
  regenerated. Its name is `SubRoutineName`, which is `never`, so only a
  routine's check, which gives it that routine's definitions' names, lets
  code call it: not a routine without definitions, not a helper typed with
  the SDK's `Macro`, and not MCP, where `@mcp-exclude` leaves it out (it
  works only inside a run). The sdk-mcp tool snapshots are main's. With
  the flag off no routine has definitions, so no code this build saves
  calls it.
- Web: only what the regenerated `RoutineTask` union needs: a copy reads as
  neither steps nor a single agent task. Showing and editing definitions,
  and reviewing an SDK rewrite of their code, come in a later change.
- `agent_harness_service`: real-Deno tests that the narrowed `schedule` and
  `inputs` types accept the right calls and reject a wrong name, a wrong
  input type, a missing input, an unknown input read, and a name chosen
  at run time given another definition's inputs; that a helper
  typed with the SDK's `Macro` takes `macro` in a routine with definitions;
  and that a routine without them can't call `schedule`.

## Deploy in two steps

What breaks: the SDK's `RoutineTask` (a routine's `detail.task`) gains a
copy's `{ sub_routine, inputs }`, so stored code that branches two ways on
it (`'steps' in task ? … : task.prompt`) fails its recheck from the deploy
on, flag or not (step 1 says what then happens to it).

Every write that gives a task definitions, program inputs or a copy's
reference, and every schedule call that gets past its run, key, name and
input checks, waits on the owner's `enable-sub-routines` PostHog flag (an
error loading it counts as off: `SubRoutinesDisabled`). Empty arrays of
either are dropped before saving. An older build refuses the fields by
shape, even empty, so clients leave them out when there are none (the SDK
and the editor in the later changes of this stack do; the SDK sends an
empty list only on an update given `subRoutines: []`, the caller's way to
remove definitions, which an older build refuses).

1. Run the migrations, then deploy with the flag off for everyone.
   - `20261119035624` creates `scheduled_action_inherited_rewrite`, empty.
   - `20261119035625` builds `scheduled_action_child_ref_idx` with
     `CREATE UNIQUE INDEX CONCURRENTLY`. It must exist and be valid before the new
     build serves traffic, since the keyed lookup can use no other index:
     `SELECT coalesce(bool_and(indisvalid), false) FROM pg_index WHERE
     indexrelid = to_regclass('scheduled_action_child_ref_idx')` must
     return true (false means missing or invalid). If an interrupted build left it invalid, drop it
     concurrently and build it again by hand with the migration's statement
     (its comment has the check and the drop): `sqlx migrate run` won't run a migration it
     has already recorded, and an `IF NOT EXISTS` rerun would record it
     over the invalid index.
   - Deploy agent_harness_service (scheduler, runner, check, drafter, code
     upgrade) and document_storage_service (GraphQL routine reads, which
     parse the stored task), and wait until both fleets run only the new
     build. With the flag off nothing writes a definition, inputs or a copy,
     so every stored task keeps the old shapes and rolling back past this
     deploy is safe for the tasks. Stored code is rechecked as on any SDK
     release: each build rechecks a routine stamped with the other's SDK.
     Code that doesn't touch the changed SDK types checks the same on
     both: the step context is main's and a routine without definitions
     gets main's check file byte for byte, and with the flag off no code
     this build saves can call `schedule` (it takes no name outside a
     routine with definitions). Code that does touch them doesn't:
     - Existing code that reads a routine's task and branches two ways,
       `'steps' in task ? task.steps… : task.prompt`, fails this build's
       check from the deploy on, flag or not: `RoutineTask` gains the
       copy's `{ sub_routine, inputs }`, which has neither. Nothing in the
       catalog, the drafter's instructions or the skills writes such code;
       how much stored code does isn't known here. Main has added SDK
       members since stored code shipped, but not widened a type stored
       code reads.
     - As with every SDK addition, code saved here that names
       `macro.routines.schedule` without calling it fails an older build's
       recheck, and code that lists every key of `macro.routines` (a
       `Record<keyof Macro['routines'], …>`) fails this build's. Main's
       `routines.suggest`, `Routine.setAppearance` and `Routine.children`
       shipped the same way.

     Where a recheck fails at a run or at startup, code that writes as
     Macro is rewritten, and the routine is paused with the reason (and the
     rewrite as a proposal, when one was made) if the rewrite fails. Code
     that writes as its owner is never rewritten: the routine is paused with
     the reason and no proposal. Either pause covers the routine and its
     sub-routines only when its own steps run code; otherwise its copies
     wait and it keeps running. A save whose code fails the check is
     refused. The recheck runs only where code runs: the startup sweep
     takes enabled routines whose stamp is stale; a run whose own program
     runs no code skips it, so a disabled agent-only parent whose code is
     only in its definitions is checked when a copy that runs code runs,
     when it is saved, or at a startup after it is enabled; and a run that
     finds the upgrade claimed elsewhere waits, without a rewrite or a
     pause. Two different changes would avoid these failures, and they
     cover different cases. Checking saved code against the SDK it was
     saved with keeps the old type for old code, so the widened
     `RoutineTask` wouldn't fail it; such code that reads a copy's task
     at run time still finds no `prompt` there and fails as it runs. An
     SDK version a build can order
     would only stop a build rechecking code that a newer build checked:
     the older build would leave this build's code alone during a rollout
     or after a rollback, but this build would still fail the two-way
     branch.
   - Keep `scheduled_action_parent_child_key_idx`, and don't rebuild it,
     while an older build can write. Postgres reports a duplicate on the
     older index first, and an older build recognises a lost keyed-create
     race only by that index's name; rebuilt after the new index, the new
     one reports first and the older build returns a 500.
2. Turn the flag on for a first cohort of owners, then widen it.
   - From the first such write, the rollback baseline for both services is
     this change's merge commit or later: an older harness refuses tasks
     with the new fields, and an older document_storage_service shows such a
     routine with no agent (its GraphQL projection returns none for a task
     it can't parse). This lists the candidates, by a scan of the table; it
     also matches older single agent tasks stored with one of these fields
     as a stray, which an older build reads as before:
     ```sql
     SELECT id FROM scheduled_action
     WHERE task ? 'sub_routines' OR task ? 'sub_routine' OR task ? 'inputs';
     ```
   - To back out, turn the flag off. Runs can no longer schedule copies (a
     copy whose own steps schedule more fails that step) and no edit gives
     a task definitions or inputs; existing copies keep
     running from their parents' definitions. A copy can still be made
     standalone, and that one write puts its values and its parent's
     definitions into the standalone task.

The web editor that shows definitions comes in a later change, which ships
before the flag goes on. Until it does, the current editor keeps a
routine's stored task when the edited steps, apps and code identity write
the same program as the stored one, as when only its name, trigger,
description or visibility change. An edit that changes any of the three
rebuilds the task without the stored definitions or inputs, and is refused
with 409 rather than dropping them. That includes the code-review
panel here, which compares and saves only a routine's own steps: it
offers approval only when they were rewritten, and approving that for a
routine with definitions is refused, not saved without them; a rewrite of
only a definition's code gets no approval control here.
Its title says the routine is paused, which for a routine whose own steps
run no code it isn't. The later change lists and saves the definitions'
rewritten code and words the panel by whether the routine is paused.

## Database review

`query-review` and `migration-review` ran on the new and changed SQL, the
migrations and the new callers of existing queries, three times; the
findings of each pass are fixed here or justified below. Plans were measured
with `EXPLAIN (ANALYZE, BUFFERS)` on a Postgres 18 scratch database with
1.1M routines (220k with code, 20k of them only in a definition), 100,050
keyed copies under one parent, a second such family added after `ANALYZE`,
and 220k upgrade rows.

| Query or statement | Rows | Relies on | Measured |
| --- | --- | --- | --- |
| Migration: `CREATE TABLE scheduled_action_inherited_rewrite` | none | its foreign key takes `SHARE ROW EXCLUSIVE` on `scheduled_action`, blocking writes until the file ends; `SET LOCAL lock_timeout = '5s'` first | instant when unblocked. Queued behind an open writer without a timeout, it made a later write to another row wait past 250 ms; with the timeout it gives up instead |
| `ON DELETE CASCADE` from the new table | one key probe per deleted routine | `scheduled_action_inherited_rewrite_pkey` | deleting a parent with 100,050 copies: 100,051 probes, 215 ms; 2.34 s for the delete against 2.10 s without the table |
| Migration: `CREATE UNIQUE INDEX CONCURRENTLY scheduled_action_child_ref_idx` (partial, keyed rows) | builds over 100k keyed rows | no write lock; runs outside a transaction | 0.63 s, 6.5 MB, valid |
| `child_by_key` (changed: parent and key as one value) | 1 | `scheduled_action_child_ref_idx` | hit 0.03 ms, misses 0.01 ms, 3 to 4 buffers, with fresh statistics; the same plan and times with 100k more keyed copies added under another parent and not analyzed, in custom and generic plans. The predicate matches no other index. |
| `child_by_key` again after a lost race (`key_taken` maps a duplicate on either unique index to it; it runs no SQL itself) | 1 | `scheduled_action_child_ref_idx` | once per lost race, as above |
| `stale_routines` (changed: one batch of the primary key) | 1,000 routines per batch | `scheduled_action_pkey` range | 0.7 to 5.2 ms per batch, 1,000 to 1,400 buffers; about 1,100 short statements for 1.1M routines, once per harness startup. Each routine it returns is then handled as before: a primary-key read; when its code checks, a task stamp and an upgrade-history insert; when it fails, a claim (none when its upgrade row is already settled, which ends the path), then either a rewrite (the task and a history row) or, when that fails, the upgrade row marked for review with the reason and any proposal, plus a pause of the routine and its enabled active sub-routines only when its own steps run code. Routines whose code is only in a definition (20k in the measured set) are new candidates: if all are enabled, stale and pass, about 20,000 reads and 40,000 writes once, beside the ~1,100 paging statements |
| Detach: `get_action(parent)`, for the definition the copy takes with it | 1 | primary key | once per detach |
| Detach: `list_upgrades(parent)` (new caller) | the parent's upgrade rows, one per SDK release | unique `(action_id, to_sdk)` | 21 rows, 13 to 16 buffers, under 0.1 ms; skipped when the detach retains no code |
| `detach_copy`: `write_action` | 1 | `scheduled_action_pkey`, revision | `update_action`'s SQL unchanged, now in the detach transaction |
| `detach_copy`: unlink UPDATE (changed: by primary key) | 1 | `scheduled_action_pkey` | Index Scan, 6 buffers |
| `detach_copy`: inherited sources INSERT (new, only when the copy holds rewritten code) | 1 | `scheduled_action_inherited_rewrite_pkey` | 0.28 ms with its foreign key check |
| `inherited_rewrites` (new) | 0 or 1 | `scheduled_action_inherited_rewrite_pkey` | Index Scan, 1 to 3 buffers; read when a save makes a routine write as its owner, and for the parent when a copy with code is detached |
| `needs_update` (changed: pauses only when asked) | 1 routine, its sub-routines, 1 upgrade row | primary key, `scheduled_action_active_children_idx`, unique `(action_id, to_sdk)` | statements unchanged; the pause pair is skipped for a routine whose own steps run no code |
| `schedule`: `get_action(parent)` | 1 | primary key | once per schedule; the create reuses that row |
| `schedule`: `running_run` / `running_run_of_session` | 1 | primary key / `scheduled_action_claim_token_idx` | the session comes from the request's validated attribution, with no second correlation lookup; 0.003 to 0.022 ms |
| `schedule`, new copy: `admit_child` parent lock and active count (main's statements, new caller) | the parent row; its active copies, at most 50 | `scheduled_action_pkey` `FOR NO KEY UPDATE`; `scheduled_action_active_children_idx` matches the count's predicate | lock 0.022 to 0.064 ms uncontended; count 0.015 to 5.05 ms over 50 active copies, finished ones not counted. Copies of one parent serialize on its row until commit, as a run's creates do on main; contention was not measured |
| `schedule`, new copy: `create_action` insert, `insert_entity`, the registry row's `FOR UPDATE` check, `upsert_owner_grant` (main's, new caller) | one row each | `scheduled_action_pkey` and the parent foreign key; `entity_pkey`; `entity_access_unique_without_project` | point writes in the parent's transaction, the path a run's `macro.routines.create` takes on main |
| `schedule`, keyed: `child_by_key`, then `update_action` | 1 | `scheduled_action_child_ref_idx`; `scheduled_action_pkey`, revision and claim checks | the lookup as measured above; the update is main's SQL, once per changed keyed copy. Turning a finished keyed copy back on skips the count (Follow-ups) |
| `schedule` or save watching GitHub: `is_linked` (main's, new caller) | the owner's first link | `idx_github_links_macro_id`, `EXISTS` | once per enabled schedule whose trigger watches GitHub |
| copy run, `prepare`: `get_action(parent)` | 1 | primary key | replaces the parent read the run notification made |
| copy run with code, its parent's SDK check: `record_checked` (task stamp, history insert), `claim_rewrite`, `save_rewrite` (task, history delete or update), `needs_update` (parent, its active copies, history) (main's statements, new caller) | one parent row and one upgrade row; `needs_update` also the parent's active copies | `scheduled_action_pkey` with the revision; unique `(action_id, to_sdk)`; `scheduled_action_active_children_idx` | once per parent and SDK release, not per copy run: the parent's stamp then matches, and copy runs racing on one parent share its upgrade row. `needs_update`'s copies update measured 0.7 to 120 ms over 50 copies and locks them until commit; it runs only when the parent's code can't be brought to the new SDK |
| copy run with code: `primary_time_zone` (main's, new caller) | the owner's mail links | `idx_email_links_macro_id`; the `OR EXISTS` branch is not bounded by it | SQL unchanged; once per run that runs code without a schedule's time zone, as for any routine on main. A run whose own steps run no code skips it, so agent-only copies and parents with code only in definitions don't read it. 63 to 914 ms on a stress fixture with 150k links; bounding it belongs to the calendar repository |
| Target validation (new callers of existing queries): `get_bot`, `get_agent`, `user_has_team`, `harness_computer_inner`, `team_agents_of` | one bot, agent, team membership or harness per selection | their primary keys and `team_user_user_id_unique` | SQL unchanged. Called once per agent selection, so a check, save or resume of one routine runs each at most 6 times (its agent and one in each of at most five definitions) instead of once; a resume that also switches its paused children on adds one per child with its own agent (`C`), and copies add none. `get_agent` measured 105 to 146 ms on a 100k-membership stress fixture, as each agent step on main pays |
| Target validation: `user_shares_channel_with_bot` (new caller) | 100k memberships per side on a miss in the stress fixture | `idx_comms_cp_active_by_user_channel`, `idx_comms_cp_active_by_channel_user`; `EXISTS` stops on a hit | SQL unchanged, reached only for a selected-channel agent whose owner and team checks fail: at most 6 per validation, and a validation stops at its first refusal, so at most one miss (84 to 954 ms on that fixture) after up to five hits. The miss's cost grows with membership size on main as well; bounding it belongs to the bots repository |
| Target validation: `PgConnectionRepo::list` (new caller) | the owner's connections (1,000 in the fixture) | `pipedream_mcp_connections_pkey`, `mcp_overlays_pkey` | at most once per validation, on the first selection that needs apps, then shared by the rest (a test counts zero reads with no apps and one for two selections); 0.5 to 5.2 ms at fixture size. A whole resume adds at most one per resumed child |
| Picked items: main's entity-access checks (channel role, document access and the other kinds), new callers for definitions' entity knobs on save, check, resume, the parent's unusable-items read, and a copy's run | one item per lookup; each distinct item once per request or run | main's, unchanged: `idx_comms_cp_active_by_channel_user`, the entity-first grant index, the primary keys | SQL unchanged and not measured here. The ceiling per request stays main's: the routine's own code steps plus every definition's are at most 40 (`MAX_CODE_STEPS`, with the largest list counted twice), each with at most 12 knobs, so at most 480 distinct lookups, as for a routine of 40 code steps on main. A copy's run checks only its definition, at most 20 code steps (240 lookups), when each step starts, as any run does. More runs, not costlier ones: a parent's active copies are capped at 50, and each fires as one scheduled run |

`scheduled_action_parent_child_key_idx` stays: older builds recognise a lost
race only by its name (see the deploy steps), and the new index duplicates
its uniqueness only for keyed rows. Copies skip target validation, so saving, scheduling or
resuming them runs none of the agent, channel and app reads; a parent's save
validates each definition's agent selections once, the same reads its own
agent steps make, with the counts in the table.

## Follow-ups

- Rows a run creates race their parent's pause and delete the same way
  ordinary sub-routines do on main, a keyed reschedule can bring a finished
  copy back past the 50-copy cap, and a code credential is matched to
  whichever run of its routine is active. All three exist on main for
  sub-routines a run creates; fixing them belongs to that code, not to
  copies.
- A routine's code is stamped with one SDK version for the routine and its
  definitions, so while a program-wide rewrite awaits its owner's review,
  copies that run code wait too, even those whose own code still checks
  (a copy whose definition runs no code skips the recheck and runs), and
  a failed rewrite of a definition pauses a parent that runs code of its
  own.
  A stamp per definition would separate them.
- A linked row (a copy, or a routine a run's code creates) stores the
  creating run's id but not its trace context, so the run that fires it
  later is found by id, not by a span link. A nullable `traceparent`
  column written on creation and linked from `routine.execute` would join
  them, for both kinds.
- The harness sends a run's notification on a task spawned inside
  `routine.execute` (`.in_current_span()`, as on main), so a slow
  notification keeps that span, and the firing's `routine.event_run`
  above it, open after the run's record is written. Spanning the send on
  its own, linked rather than nested, would end `routine.execute` with
  the run and `routine.event_run` with its finalize.
- An SDK version a build can order against its own, so a build never
  pauses code that a newer build checked (an older replica during a
  rollout, or after a rollback). Every SDK addition, these included, can
  otherwise fail the other build's recheck.
- In agent_harness_service the correlation middleware sits outside the
  request tracing layer on every route, so its own events are not in the
  request's span. That predates this change and covers all harness routes.
- The scheduled-action API's fallback logs a database error with `Debug`,
  as on main. No saved task, and no key or name a run schedules, can carry
  the NUL that makes Postgres quote neighbouring text into such an error; a
  routine's own name sent to create or update still can, as on main.
- Drop `scheduled_action_parent_child_key_idx` once a release has served
  keyed lookups from the new index and no older build can write, and
  report the new constraint alone.
- The web editor shows and edits definitions, and its code-review panel
  approves their rewritten code, in a later change of this stack.
- Templates of routines with definitions or input values, once activation
  offers to swap the workspace items they mention.
- The customer guide (`apps/docs/product/routines.mdx`) describes sharing,
  duplicating and MCP edits without the rules for copies and definitions.
  No user can have either until `enable-sub-routines` is on, so the guide
  changes with that rollout; the agent guide and the SDK README say them
  now.
