## Why

A request like "remind me the day before each task is due" needs the same
work done later for every item a run finds. The routine drafter (the
editor's Draft it) had no way to write that as one reviewable definition:
it left the per-item work to an Ask AI step on every run, or drafted a
routine that couldn't do it. The change below this one lets a routine
define such work once and schedule copies of it; this one teaches the
drafter to write it.

## How it works

```
"Every morning at 8, for each of my open tasks due in the next seven days,
 remind me at 9am the day before it's due."
        │
        ▼  drafter session (code allowed, owner has enable-sub-routines)
 steps:        [ code: list open tasks due this week,
                       for each: macro.routines.schedule('remind_before_due',
                         { trigger: { type: 'once', at: 9am the day before },
                           inputs: { taskId }, key: `remind:${taskId}` }) ]
 subRoutines:  [ { name: 'remind_before_due', title, inputs: [taskId],
                   steps: [ Ask AI: tell the owner about the task } ]
        │
        ▼  macro.routines.check types the schedule call against the
           definition's name and inputs; the draft returns both
```

## What

- Drafter (`domain/drafts`, `finding/later.md`): a new routine that may have
  code, whose owner may save sub-routines, is told to define per-item later
  work once in `subRoutines` (name, title, inputs, steps ending in the Ask
  AI step that tells the owner) and to schedule one keyed `once` copy per
  item from a code step, at a time on the owner's clock. The instructions
  give the rules the scheduler and the type check hold a copy to: the name
  and input-name grammars, every declared input passed by name and type,
  `at` as an ISO 8601 time with its offset, keys shared across a routine's
  sub-routines, the cap on scheduling (a new one only while fewer than 50 are
  active: copies and any other routine its runs made, together; a one-time
  one counts until it fires at its time, even if that run fails; a keyed
  reschedule adds none, and can bring back a finished one at the cap), and
  the 40 code-step budget as the checker counts it. The scheduler also
  stops counting a one-time copy once a run started by hand ends after its
  time; the instructions leave that out, since a drafted routine doesn't
  start its copies by hand. Work that repeats until
  something happens stays a routine on that schedule. The instructions stay
  one cached prefix per combination of code, conditions and this.
- Whether the owner may is read per owner from the `enable-sub-routines`
  rollout (`DraftSubRoutines`; an unreadable flag is off), only for a new
  routine that may have code: one flag read per such draft, in its own
  span (`routine.sub_routines_flag`), for owners with the flag off too;
  their instructions don't change. Step drafts and drafts without code read
  no flag for their instructions; the scheduler still checks it when a
  submitted task uses definitions or inputs.
- What a draft hands back is checked against two things the session
  can't change: the decision its brief was made with, and the definitions
  it was given. A new routine carrying sub-routines when the brief didn't
  offer them (no code, or the owner's flag off when the draft began), or a
  step checked with other sub-routines than the routine's, fails the draft
  (`routine.draft.sub_routines_refused`) rather than handing back
  something the editor can't save or that differs from what was checked.
  Definitions are compared as checked: in name order, and each one's
  inputs too, since copies find theirs, and steps their inputs, by name;
  without their apps, which the SDK a session checks with
  can't hold and no code reads; and with order of fields, omitted defaults
  and assigned ids normalized. The step is applied to the routine as the
  editor holds it. The prompt hands the routine's definitions to the
  session as stored, so it is told that an Ask AI step's
  `agent: { bot_id }` there is `macro.agents.byId(bot_id)` in the SDK.
  What this doesn't catch, and why it is left:
  - The check runs inside the session and ends its turn when it passes, so
    a draft refused here gets no second try: a session that checked a step
    after dropping an unused definition fails rather than resubmitting.
    Feeding this comparison into the check would need the check to know
    the draft's routine, which is the session's tool contract, not this
    change's.
  - The flag is read once, at the brief. If the session's check then
    refuses the definitions because the flag is off or can't be read
    (`SubRoutinesDisabled`, a problem the session can't fix), the draft
    fails with a message saying per-item scheduling isn't available right
    now, instead of being handed back ready without the problem. That
    refusal covers creating the routine and any change to a stored
    routine's task that keeps sub-routines or inputs; a step draft that changes nothing in the task would
    have saved, and fails with the same message. A draft
    already handed back can still be refused at save, with the reason, if
    the flag turns off or can't be read by then; nothing is saved. Other
    configuration problems of a session's last check are not carried
    when it ends without a passing one, as on main: the draft falls back
    to that check's steps and code problems.
  - The comparison is of the definitions, not of the check's files. The
    checker numbers a routine's check files in the order its definitions
    come, so a session that checked them in another order checked files
    whose self-imports are named differently (`step_9.ts` against
    `step_10.ts`); a file within a byte of the checker's limit could pass
    one and not the other. The editor's save checks the routine again as
    stored, so such a draft is refused at save, not saved unchecked.
  - A step session can change an earlier step while checking the new one;
    only the new step is applied, so the check may have seen a different
    program. That is so on main for any step draft.
  - A detached copy's input values aren't in `RoutineSoFar`, so a step
    drafted for one is checked without them; the editor (next change)
    doesn't offer AI step drafting on such a routine.
- The draft hands the definitions back in `DraftedRoutine::sub_routines`,
  and a code problem inside one names it (`StepProblem::sub_routine`, a
  `SubRoutineName` from the checker to the hand-back, a string on the
  wire). Normalizing definitions and the hand-back checks moved out of
  `domain/drafts.rs` into `drafts/definitions.rs` and `drafts/hand_back.rs`
  (with its tests), so `drafts.rs` and its tests end shorter than on main;
  the step guidance a code-writing draft gets moved from an inline string
  to `finding/steps.md` (every variant of the instructions is
  byte-identical), and this change's finding tests sit in
  `finding/test/sub_routines.rs`.
  Adding or changing a step in a routine with sub-routines keeps them as
  they are and checks the step with them (`RoutineSoFar::sub_routines`).
  Spans record whether sub-routines were offered and how many the draft
  defines.
- The apps a draft names (main's #11387: the apps its Ask AI step uses,
  and those the owner hasn't connected) are the routine's own Ask AI
  step's. A definition's Ask AI step runs with the definition's apps,
  which a draft can't set, since the SDK can't hold a definition's
  `mcp_servers`; so a routine whose only Ask AI step is in a definition
  hands back no apps, and the brief's apps section still describes the
  routine's own step. The sub-routine instructions say so: a sub-routine's
  steps can't use apps, no app is named in the check for one, and later
  work for each item that needs an app is the routine's own Ask AI step's,
  on its schedule. The scheduler change below drops a definition's
  required apps from the missing ones as it does the routine's.
- SDK: steps routines take `subRoutines` ({ name, title, inputs, steps }),
  sent as the task's `sub_routines` by create, update and check, so a
  session drafting or creating such a routine can check and save it. A
  create or check leaves an empty list out, since an older scheduler
  refuses the field even empty; an update sends it, which removes the
  routine's definitions. Each input is sent as its declared `type`, `name` and
  `label` only. A definition's types are main's step types, so an empty
  step list or an Ask AI step without a target type-checks; the scheduler
  refuses either with its own message when the routine is checked or
  saved. The README and the routine-composing skill say that an update
  passes the sub-routines back (`[]` removes them), and that an update
  keeping a definition with apps, or of a routine with saved input values
  (a detached copy whose definition had inputs), can't be made through the
  SDK, which can't hold either (the scheduler refuses an update that would
  drop them, 409); `setEnabled` sends no task. The sdk-mcp
  tool snapshots carry the new option types wherever routine options
  appear: `create`, `check`, `update`, `suggest` (which takes a routine and
  returns its outcome) and `activateTemplate` (which takes options and
  returns a `Routine`).
- Drafting eval (`bench/`): two requests whose good draft defines the work
  once (`due-soon-reminders`, `review-check-later`). The draft check wants
  a sub-routine and a code step calling `routines.schedule`; the run check
  saves the routine with its definitions, fires it, and reads the
  children it made from a second before it fired: copies, and any
  ordinary child, which then fails the check for naming no definition. Each copy must name a task the case wants by an
  input equal to its seeded id, with a key holding that id, at the time
  that task needs (9:00:00 the day before it is due; for
  a review, 72 hours after the clock reading the check takes before it
  reads the task's status and changes it to fire the routine, within an
  hour), with no task twice
  and a definition ending in an Ask AI step. Every copy is then run at
  once, by hand, and its reply must name its own task (a mention counts,
  read with its name, as in messages); messages, tasks and
  notifications are read after the copies run. These checks match strings
  and run each copy once, by hand: they don't see a copy fire at its time
  or after its item changed (a task that left review), that the input
  is the one the copy looks its task up by, that a key stays the same
  from one run to the next (a key holding a hash of the id, which would,
  fails), or that a reply naming its task did what was asked (a reply
  saying it didn't check the task passes). They don't fail a copy for
  writing something else, and writes a copy's own run schedules after the
  copies were read aren't seen. A copy is taken to be the fired run's by
  time (any child made from a second before the fire request); in the two
  cases that run copies, each such child that names a definition is run,
  so writes of a copy that isn't the fired run's can meet another check.
  Results saved
  before these checks lack the evidence they read, so `reread` fails them;
  compare fresh runs. A reply's mentions are read with the names their
  items have when the check runs, so a reread can differ once an item is
  renamed (the reread then holds the old name beside the new one, so either
  matches), and rereading a result whose replies or messages hold mention
  tags needs the stack's Postgres to read those names (offline it fails).
  The blind judge reads a draft's sub-routines. The
  eval's harness swap now names only `/app/out`, so the stack's other
  harness mounts survive it. Only these two cases run copies; a copy's
  reply that can't be read fails that copy, not the others. Each copy's
  run has one four-minute deadline (`AbortSignal.timeout`) shared by its
  execute request, the history polls every two seconds, the settle and
  the reply reads (no read starts once it has passed), so a read that
  never returns leaves that copy's run without its reply instead of
  holding the attempt, and closing the eval's database waits at most five
  seconds for such a read. A read left behind keeps its pool connection
  until then; an attempt runs a few copies, well under the pool's ten.
  The parent's run is waited for as on main: its history polls stop after
  four minutes, but its execute request and each read have no deadline of
  their own, so one that never returns holds the attempt, as for every
  case on main. The run check's execute, history, delete and task-status
  requests carry the attempt's `traceparent`, and its trace id is saved
  with the result; the message or task an event case creates to fire its
  routine goes through the SDK without it, as on main, so that run is
  found by routine and time rather than by trace. The later runs the
  check starts don't count toward the draft's time.
- What the eval shows (main against this branch, the two cases four times
  each, the 20 earlier cases twice): `review-check-later` drafts pass every
  check 2 of 4 times here and 0 of 4 on main, which has no way to define
  the check once; the earlier cases pass 80% on both, with time within
  noise. `due-soon-reminders` passes 0 of 4 on both. Here every draft
  defines the reminder and schedules it from code, and all four fail when
  the routine runs, because code has no way to list the owner's open tasks
  by due date: two searched with an empty query (400 `query must not be
  empty`), one read tasks' documents with entity type `document` where
  the API takes `DOCUMENT` (422), and one found no tasks
  and scheduled no copies. Due-date reminders drafted this way fail at run
  time until code can list tasks by due date; see Follow-ups.

## Rolling deploys

- While the build below this change still serves, a step draft sent to it
  with `sub_routines` in its routine is refused (its request type refuses
  unknown fields), a draft it makes carries no `subRoutines`, and a
  finished draft the new build stored, read back through it, loses them and
  the `subRoutine` that places a step problem inside one. Once this build
  has stored such a draft, roll back no further than this change while
  drafts can still be read back. Only owners with the flag can get such a
  draft, and the flag stays off until the web editor change of this stack
  ships and this build serves alone. The current editor would lose such a
  draft's work: it takes a drafted routine's own steps and drops
  `subRoutines`, and places a step problem by its index alone, so a
  problem inside a definition would show on the routine's own step with
  the same number. Saving the scheduling step without its definitions then
  fails the check.
- For owners without the flag, a new routine that may have code reads
  the flag once per draft (`routine.sub_routines_flag`) and their
  instructions are as before. The SDK reference the session reads carries
  `subRoutines`, so a session that uses it anyway gets the draft refused,
  as above.
- The SDK's declarations change, so the checker's fingerprint moves and
  every stored routine with code is checked once more where code is
  checked, as after any SDK release (the scheduler change lists where it
  isn't); while both builds serve, a routine can be checked again on
  whichever replica's fingerprint it doesn't carry. Code saved here that
  passes `subRoutines` from a step to `macro.routines.create`, `check`,
  `activateTemplate`, `suggest` or a routine's `update` as an object
  literal fails
  that check on an older build, even with an empty list (passed through
  a variable whose type the older build infers, it checks on both and an
  older build drops the field; one annotated with the older
  `RoutineOptions` fails at its declaration): the older code upgrade may
  rewrite it, or mark it for review and pause it when its own steps run
  code (one that writes as its owner is not rewritten). `suggest` works only
  in a suggestion-generating session, but its literal fails the older
  build's type check all the same. So the rollback
  floor above covers stored code too: once this build has saved such
  code, roll back no further than this change, and while both builds
  serve, an older replica can recheck it. Before the flag is on, the
  scheduler refuses non-empty definitions on a create or update when it
  runs, and `check` reports them refused, so such code does nothing with
  them until the flag is on. No drafting prompt, catalog routine or skill
  example writes `subRoutines` in a step's code (the drafter defines
  sub-routines on the task, and the composing skill passes them from a
  session, not a stored step), so the code this reaches is code an author
  wrote to create or check routines with definitions from a routine.
  The flag doesn't fence this either: with it off, such code can still be
  saved and run (an empty list, or a `check` whose refusal the code
  handles). An older replica that claims a run of such a routine rechecks
  its code only after the claim, so a one-time routine's firing is used
  up before the check fails, and code that writes as its owner is paused
  when the routine's own steps run code and that build claims the upgrade
  (one that finds the upgrade already settled for its SDK leaves the run
  waiting instead).
  Waiting for this build to serve alone before turning the flag on
  doesn't close that window, which is the rollout's overlap (and any
  rollback) whatever the flag. Closing it needs saves of such code held
  until no older replica serves, or a release that makes an older replica
  set aside a routine whose code carries a newer SDK stamp before it
  claims a run of it or sweeps it, without running its upgrade path (which
  would rewrite or pause it); this stack has neither. Main's routine SDK
  additions since stored code shipped had the same window; the scheduler
  change below this one lists an SDK version a build can order as a
  follow-up.

## Follow-ups

- The editor's AI step authoring writes a routine's own steps, not a
  definition's: a definition's code reads inputs the author isn't told about.
- A way for routine code to list the owner's open tasks due in a range,
  bounded and index-backed, so due-date reminders work; the drafter's
  later-work guide then points at it and the eval runs again.
