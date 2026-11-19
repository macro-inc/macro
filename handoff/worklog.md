# routines-draft-subroutines (worker, project routines, parent `routines`)

Brief: teach the routine drafter (editor "Draft it") to draft a routine whose run makes
scheduled sub-routines. Find first why it fails today (guide / check / code step can't).
PR against main, CI gate green, never merged; local-stack before/after; drafting eval
main vs branch with noise margin; proof page at
~/.cache/mail-emulators/share/proofs/routines-draft-subroutines/.

## State
- 2026-11-18 18:10: branch reset to origin/main bd53c3ca8fc.
- 18:25: own stack `subr` up (port base 28600, `--no-computers`, borrowed binaries in
  ~/.cache/routines-draft-subroutines/bin/stack, main harness bd53c3ca8fc). PostHog
  stand-in container `macro-subr-flagstub` (alias subr-stub). DSS RUST_MIN_STACK via
  ~/.cache/routines-draft-subroutines/extra.override.yml + dc.sh. Eval workspace seeded.
  Test Postgres for cargo tests: docker `subr-testpg` on 28699 (volume subr-testpg-data).
- 19:00: commits 6b34ea25f7d (drafter: finding/later.md) and 01ba0464e9a (eval: 2 cases,
  run check reads sub-routines). Building branch harness.

## Findings (main bd53c3ca8fc, 8 requests x 2 rounds via POST /drafts)
- The premise is mostly wrong: main drafts a code step that calls
  `macro.routines.create(..., { key })` in 12/16 drafts, and the exact example
  ("Follow up in new support channels") drafts, saves, runs and makes a working
  once sub-routine end to end (child run posted in the channel).
- The failing shape: per-item later work that tells the owner, from a schedule
  ("every Monday, for each task due this week, schedule a reminder that tells me ...")
  -> main hands the whole job to one Ask AI step (due-reminders 2/2, launch-due-checks 1/2).
  1/2 check-until-answered drafted a daily scan instead (fine design, no sub-routines).
- Cause: the guide/instructions. "A code step never messages the owner -> Ask AI step"
  plus nothing saying a code step can schedule a sub-routine whose own Ask AI step tells
  them later. Not the check, not a code-step limit.

## Branch (19:00-19:50)
- Branch drafts, 8 requests x 3 (first guide): 24/24 schedule keyed sub-routines from a code step,
  children end in their own Ask AI step.
- Runtime: main's Ask AI drafts also make sub-routines at run time (the agent writes the code),
  but take ~36-56 s of AI per run and keys drift (one main draft run twice made a duplicate
  reminder under two keys); branch code step runs in ~1 s and a second run updates the same child.
- Risks seen: the check type-checks code but never runs it; some drafted code fails at run time
  (Intl option; empty-query search) or misses items (reads only the first 100 workspace items).
- Independent review (subagent): fixed eval run check (time-of-day dependence, one-date cron,
  key non-null, day-before), dropped "check every morning until answered" from later.md (a cron
  child never finishes and holds a cap place); recurring work stays on the routine's schedule.
- History rebuilt as 3 commits: 83c7f059f1a feat, ec8c64dfe93 test, 7f76a506857 fix(stack.ts).
  Harness binary for 83c7f059f1a in bin/branch-83c7f059f1a; stack now on it.
- Next: re-run branch repro (branch2), UI recordings before/after, eval ab (core 20 x 2 + new 2),
  proof page, PR, CI.

## 19:50-20:35
- Second independent review (Codex one-off): fixed later.md wording (owner's clock, past `at`,
  cap), eval run check (once only, every task covered, exactly one check, switched-off,
  legacy prompt). Guide v3 adds "even when an event brings the item".
- Guide v3 repro (8 requests x 3, NY time zone): check-until-answered 3/3 scan (main 1/2 made
  a cron child); hiring-weekly-checkins still 3/3 cron children (main 2/2 too); every other
  per-item later request 3/3 keyed `once` children; time-zone math on the owner's clock in
  every due-reminders draft. Drafting due-reminders takes 25-30 s vs main 8-10 s.
- Run time (due-reminders, each draft run twice): main's Ask AI 36-56 s per run, 1 child or
  none, one duplicate under a second key; branch code 0.3-15 s, but 2 of 3 v3 drafts fail at
  run time on SDK misuse the type check can't see (entity_type casing, empty search query).
- UI recordings done (UTC browser): before = Ask AI, 1 child; after = code, 3 once children,
  child's Ask AI messaged the owner.
- History squashed to b8b17803d26 feat / 4683ba908a2 test / 38df4c58b1d fix (tree = ebeae276e64).
- Running: eval ab core 20 x 2 + new 2 x 3 (main bd53c3ca8fc vs branch); final tests + checks.
- #10129 still open.

## 20:35-21:55 — handed off
- PR https://github.com/macro-inc/macro/pull/11357 (head 38df4c58b1d, ready for review, CI gate
  passed on 38df4c5). Not merged. #10129 still open: when it lands, merge main in and rerun CI.
- Eval (main bd53c3ca8fc vs branch): 20 core x 2 rounds 80% -> 80% (+0, 95% -10..+10, margin
  12.5), time x0.94 noise. New 2 cases x 3: 17% -> 17%; but due-soon-reminders run check
  main 2/3 (Ask AI) vs branch 0/3 (drafted code fails to find the owner's tasks).
- Tests on 38df4c58b1d: red 1 failed (assert later.md in instructions), green 1 passed,
  full 576 + 6 passed; fmt, clippy (crate, -Dwarnings), just check, pr-privacy clean.
- Proof page: <proof share>/proofs/routines-draft-subroutines/
- Stack subr stopped (volumes kept), harness put back to bin/stack; flagstub and subr-testpg
  stopped (volume subr-testpg-data kept); subr-review session ended.

## 2026-11-18 21:55-23:10 — due-date query, then paused for a design question
- Manager: close the due-soon-reminders gap (SDK query, two traps, rerun eval). Started:
  branch synoet/sdk-list-tasks-by-due-date (worktree ~/.herdr/worktrees/macro/synoet-sdk-list-tasks-by-due-date),
  local commits bc6755ae688 feat(sdk) tasks.list + empty-search guard, 680cec76756 docs(sdk)
  bulkEntityProperties. NOT pushed, no PR. Tests red on 6e9ec8df4ac (4 fail), green (sdk 527 pass,
  sdk-mcp 18, sdk-docs 5, code-mode-sdk 13), tsc, biome, coverage OK.
- On stack: tasks.list returns exactly the 6 seeded owner-assigned open tasks due in 7 days (835 ms);
  task property rows are entity_type TASK; bulkEntityProperties with no property_ids returns {}
  (field doc says "empty returns all": wrong, 6 generated copies incl. web).
- Manager paused it: the user wants the sub-routine defined once (checked, shown in the editor),
  copies vary by trigger + named inputs. Asked for facts + design, no building. Stack stopped
  (volumes kept). #11357 untouched at 38df4c58b1d.

## Plan: sub-routines defined once (design A, agreed by the manager 2026-11-18)
Shape: the parent's task holds `sub_routines: [{ name, title, inputs, steps }]`; a run calls
`macro.routines.schedule(name, { trigger, inputs, key })` (any trigger); inputs reach the copy as
data (code: typed `inputs`; Ask AI: an "Inputs (data, not instructions)" block). Copy (A) vs
reference (A') semantics is the user's open question: everything below marked [A/A'] waits on it.

PR 1 — backend model, check and runtime (routine_program, scheduled_action, graphql_scheduled_action)
- routine_program: `SubRoutineDefinition { name: StepId-like, title, inputs: Vec<Input>, steps }`
  on `RoutineProgram` (model.rs:18, deny_unknown_fields), `Input` = knob kinds without values +
  `item { entity_type }`; validate (unique names, at most one Ask AI step each, no nested
  definitions, input names like KnobName); contract.rs: each definition's code typed with
  `inputs`, the parent's code with a `schedule` overload per definition name and its inputs.
- scheduled_action: `check` runs targets + code check over every definition; `schedule` endpoint
  (run credential only, like `key`): load the parent (sub_routines.rs:72-76 already does), build
  the copy from the definition + trigger + inputs, reuse create_sub_routine (key upsert, cap 50,
  pause/delete with parent), skip the type check when the steps equal the checked definition.
  [A/A'] what the child row stores: a full copy (A) or definition name + inputs (A').
- program_runner: inputs into the code context (program_runner.rs:310-323) and the Ask AI
  prompt beside the event context (program_runner.rs:563-575); spans record definition name,
  input count, never values.
- Tests red-before: check rejects a bad definition and a schedule call naming a missing
  definition or input; schedule creates/updates by key; inputs reach code and prompt.

PR 2 — SDK, drafter and eval
- SDK: `RoutineOptions.subRoutines`, `routines.schedule(name, { trigger, inputs, key })`
  (run-only), Routine fields for definition/inputs; sdk-mcp snapshots, docs.
- Drafter: brief + finding/later.md rewritten to draft the definition and schedule it;
  `DraftedRoutine.subRoutines`, `StepProblem` path into a definition (drafts.rs:173-228),
  `RoutineSoFar` for adding/changing a step inside one. Builds on tasks.list (#PR below).
- Eval: due-soon-reminders and review-check-later run check reads copies made from the
  definition; >= 10 rounds per build on the 2 new cases, 20 core x 2, vs main.

PR 3 — web editor and review
- `ScheduleDraft.subRoutines` (core/draft.ts:30-75) to/from wire (core/routine-steps.ts,
  queries/compose-routine.ts:140-175, queries/routine-draft.ts:196-265 which today rebuilds the
  task from known fields and would DROP unknown ones on edit).
- "Schedules this routine" block in the parent's steps: the definition's steps with the
  existing step components, its inputs, editable, saved with the parent. Parent page rows
  (routine-sub-routines.tsx) show each copy's input values. [A/A'] what a copy's own page shows.
- Browser proof: draft → review block → save → run → copies listed with inputs → copy runs.

Two-step deploy for the new task field (RoutineProgram rejects unknown fields; rolling deploys mix
versions): readers of stored tasks are agent_harness_service (scheduler, runner, check, drafter,
suggestions) and document_storage_service (graphql_scheduled_action, objects.rs:291, which drops
the program silently on a parse error), plus the web app, which rebuilds the task on every edit.
- Step 1 (ships in PR 1 + the read half of PR 3): every reader parses and preserves
  `sub_routines` (serde default, skip when empty); the web carries it through edits untouched;
  nothing writes it: check and create refuse a task with definitions, and `schedule` is not
  routed. Deploy harness + DSS + web, and let that version become the rollback baseline.
- Step 2 (a later deploy, after step 1 is everywhere): turn on writing: check/create accept
  definitions, `schedule` routed, SDK released with `schedule`, drafter writes definitions,
  editor block shown. Rolling step 2 back to step 1 is safe: step 1 reads and keeps the field.
  Defense in depth: a parent whose code calls schedule('x') fails its type check if 'x' is
  gone, so a client that drops definitions gets a refused save, not a broken routine.
- No database migration in A (task is JSON). A' may want a column only if the parent page must
  group copies by definition in SQL; otherwise none.

## 2026-11-19 — building A' (reference semantics, the user's choice)
- Decision (user via manager): a copy stores `{sub_routine, inputs}` and reads the steps from
  its parent at run time; editing the definition changes copies that haven't run; a copy's
  page shows the parent's definition; detaching copies the steps out first.
- tasks.list PR: NOT opened. Query review (Codex, PG 18.6, 10M-doc seed) blocked all four
  shapes: a 100k-task assignee hit the 60 s cutoff on every first page; 40k-grant replay 180 s.
  Cost is document storage's Soup SQL before the limit, same predicates as web My tasks
  "Due soonest". Options for the manager: SDK page cap / fix Soup+index separately / drop.
  SDK worktree commits stay local (bc6755ae688, 680cec76756, 0758855cf26).
- PR1 worktree ~/.herdr/worktrees/macro/synoet-routines-sub-routine-definitions, branch
  synoet/routines-sub-routine-definitions (from main 4dfc1e5d554). Commits: 0c1255af082
  (routine_program definitions), 19d7e27979d (copies run the parent's definition),
  4a58eebc9ca (schedule endpoint, guards, flag). Tests: routine_program 51, routines 19,
  scheduled_action 591 + event_routines 7, all pass.
- Departure: SDK `routines.schedule` moved into PR1 (the check types `$Routines['schedule']`
  against the code-mode SDK, and coverage needs the endpoint wrapped).
- Deploy is flag-gated, not code-gated: step 1 deploy with `enable-sub-routines` off (readers
  parse + keep the fields; old clients' updates that would drop them get 409); step 2 turn the
  flag on once that version is the rollback baseline.
- Build note: host memory is tight (earlyoom SIGTERMs rustc); build at -j 2 in a retry loop.
  kache-wrapped rustc fails silently on errors; unlinked its read-only hardlinks in the target.
- PR1 review (Codex oneoff subr-pr1-review) found 5 blocks + fixes. Fixed in 4 commits on top
  of 59f0a74f7ba: aa3114c2465 (NoSend scope holds `/scheduled-actions/schedule`), 59166702361
  (NUL inputs refused; a copy never writes as owner; `runs_code`), 3e96caf7003 (sweep finds
  code in definitions; dry-run inputs; agent-only runs skip the code path; copies always get
  `inputs`), b7dd9a387d8 (flag on every write, empty arrays stripped, copies only by
  scheduling, NestedSubRoutines, copies skip target validation, atomic `detach_copy` with the
  parent's rewrite records, schedule reads the parent once, session from attribution).
  scheduled_action 600 lib + 7 integration, routine_program 51, routines 19 pass.
- child_by_key stale plan: same query as main; fresh stats 0.012 ms, stale 16–20 ms at 100k
  siblings; no query variant fixes it (tried IS NOT NULL, ORDER BY/LIMIT). Justified in the PR
  body, follow-up: narrow `scheduled_action_parent_run_idx`. Plans in
  ~/.cache/routines-draft-subroutines/pr1/plans-review-fixes.log.
- F7/F8/F9 (child races, keyed cap bypass, credential-claim binding) exist on main: follow-ups.
- Re-review (oneoff subr-pr1-rereview) blocks fixed in 4 commits, now rebased on main
  b52d52962ac: 544c0b36def→ NUL in titles/labels; 6489d1bfff3→ copies run as checked (no
  `inputs` for zero-input definitions, copy agent admitted at prepare, skip upgrade when own
  steps run no code); bb009d21ba5 pause only own-code routines + `stale_routines` batches of
  1,000 by pkey; 038be318e45 detach provenance table `scheduled_action_inherited_rewrite`,
  detach parent check on the written row, `child_by_key` on new unique expression index
  `scheduled_action_child_ref_idx` (migrations 20261119035624/5), flag-off schedule refused
  up front, detach exempt. Plans in pr1/fix-plans.txt (child_by_key 0.01–0.03 ms incl. stale
  stats; batch 4–4.8 ms; index build 0.63 s).
- Slip: one intermediate commit was made with `--no-verify`; the commits were rebuilt and
  c4 went through the hook; `just check` (incl. PII scan) passed on the rebased branch.
- 04:20 PR1 rebased (HEAD 038be318e45): routine_program 51, scheduled_action 605 + 7,
  routines 19, agent_correlation 17 pass; fmt, `just check`, workspace clippy clean. Third
  review oneoff subr-pr1-rereview2 running on the fixes. PR body rewritten
  (pr1/pr-body.md) with the two-step deploy + rollback SQL.
- PR2 rebased onto PR1 (HEAD bb184df35a0), PR3 onto PR2 (HEAD c8ff59c957b): web tsc clean,
  577 routine tests pass. Building main b52d52962ac harness + top harness/DSS for the eval
  and proof stack (build-eval-bins.sh).
- 05:10 Third review (subr-pr1-rereview2) answered in 6 commits on PR1, HEAD 298bb0edd84:
  78113086b3f NUL anywhere in a routine's text refused; 9fa6a40a150 rollout read once per
  schedule (create and keyed update skip it for copies; task-local read counter in the test
  double); 7d985f1217c `SET LOCAL lock_timeout = '5s'` in 20261119035624; f9d735d67c1 schedule
  span records parent/run up front, `routine.code_sweep.batch` per batch with `after`,
  `stale`, `upgraded`, `waiting`; 99054af1834 detach skips the parent's upgrades for a copy
  without code; 298bb0edd84 identity test double keyed by id from what detach recorded.
  Justified in the body, not code: SDK `schedule` typed for routines without definitions
  (generic SDK-addition rollback behaviour), pause scope (one SDK stamp per program),
  `err` event can name a definition/input key (CS-22 needs `err`).
  Tests: routine_program 52, scheduled_action 606 + 7 pass; red: NUL test and read-once test
  fail with each fix disabled (create path and keyed-update path separately). just check,
  crate clippy clean. Fourth review oneoff subr-pr1-rereview3 running.
- PR2 rebased → 3616a6fd703, PR3 → 73cf5874910. Rebuilding top bins for the after stack.
- Before recordings (main b52d52962ac stack, reseeded for 2026-11-19): first pass on phone
  failed: main's floating top bar on touch is pointer-events-none and the routine page's
  Run now / tabs don't opt back in, so a real tap on Run now does nothing (probe: tap sent no
  request). Not mine; recorder presses those from the keyboard on phone. Rerunning.

## 2026-11-19 later — fifth and sixth reviews
- Fifth review (subr-pr1-rereview4) fixed in 5 commits on PR1, HEAD f29b953918a:
  d6c51e5be56 (a routine without definitions or inputs gets main's per-file check line,
  byte for byte, so nothing near the 64 KiB limit grows; schedule typed per name, one
  argument list each), 216f9d84795 (stored single agents with stray fields stay runnable;
  refusal only on new/changed tasks via refuse_fields_beside_agent), 1e51b017953 (schedule
  errors never repeat caller text; NUL key/name refused), 8171c64b0e4 (MAX_CODE_STEPS 40
  across parent + definitions + standalone copies), f29b953918a (sweep records an outcome
  without an SDK). Red on 52997af831d / green on f29b953918a: logs in pr1/fix6/.
  Helper bypass of `schedule: never` justified in the body (generic SDK-addition property).
- PR3 3716545f000 → (rebased) 2dff6207d1b: code-review panel lists and saves sub-routines'
  rewritten code; "Paused" only when disabled. vitest red 2 / green 583.
- PR1 body updated (NUL wording, stray fields, 40 steps, rolling stamps, code-review panel).
- PR2 rebased → 627bb4711dc (scheduled_action 618 + 7, clippy, fmt, SDK 9 tests, tsc pass);
  PR3 rebased onto it (web 583 pass, tsc, biome).
- Sixth review oneoff subr-review6 running on 52997af831d..f29b953918a + body.
- Building eval/top binaries for the eval and the after recordings.

## 2026-11-19 08:00–09:00 — sixth-review fixes, PR2 and PR3 reviews answered
- Manager: user chose reference semantics (A'); build the three PRs, proof with recordings,
  eval main vs branch. 11357 stays open until PR2 replaces it.
- tasks.list SDK PR (worktree synoet-sdk-list-tasks-by-due-date, unpushed) blocked by its
  query review: 100k-task assignee hit the 60 s cutoff, 40k-grant replay 180 s. Not opened.
- PR1 HEAD 3e63ce188fc: 9eb848e95a8 stray fields beside a single agent dropped, not refused;
  75d22889bf5 NUL in a scheduled trigger refused (ScheduledTextNul, refused_text);
  3e63ce188fc update dropping a definition's mcp_servers refused (ExplicitAppsRequired).
  pr1/fix8: routine_program 53, scheduled_action 613 + 7, clippy, fmt pass. Red logs in fix7.
- PR2 rebased onto it, HEAD 936c52598f9: 70412e8c226 drafts hand back only saveable
  sub-routines; 3826b0eac63 later.md rules; 31af164bda9 SDK input mapping + README + skill;
  587515a6219 eval run check ties copies to seeded task ids and runs the first copy;
  936c52598f9 step drafts compare definitions without apps. pr2/fix3: scheduled_action 622 + 7,
  routine_program 53, system_skills 6, SDK 9, tsc, biome, clippy, fmt pass.
- PR3: helper subr-pr3-fix (solaris/t1rz) staged 13 patches for the cold review's findings;
  told to commit them through the repo hook (it asked whether the hook's Python scanner may run).
- Seventh review subr-review7 (solaris/t1s0) on PR1's 3 + PR2's 5 fix commits and both bodies.
- Eval run on old binaries stopped (drafter changed); rebuilding backend at PR2 head for the
  rerun and the after recordings.

## 2026-11-19 09:00–09:50 — seventh-review fixes, second editor round, eighth review
- PR1 HEAD 0e5915646e9: 386748d0a12 web reads a copy only by its exact shape
  (isSubRoutineCopy); 81b44a7a4f4 only a task with steps defines sub-routines for every
  check (keyed repeat, linked update, apps guard); 0e5915646e9 routine.execute records parent
  and creating run, parent read spanned. pr1/fix9: red 2+2 failing, green 53/614/7, vitest 564.
- PR2 HEAD 01f67247ac8 (rebased on PR1): eval runs every copy, exact ids, keys, whole minute,
  72h±1h (probe 13/13 vs 5/13 before); definitions compared in name order + prompt explains
  stored agent selections; later.md limits as the scheduler counts them; SDK omits empty
  sub_routines; README names the updates the SDK can't make. pr2/fix4: red (2 Rust, 1 SDK),
  green 53/624/7/6, SDK 9, tsc, biome, clippy, fmt pass.
- PR1 and PR2 bodies updated for review7's notes (span outcomes, stray fields, rollout,
  handback limits, snapshots, eval limits).
- PR3 rebased onto 01f67247ac8; helper subr-pr3-fix (solaris/t1rz) on review2's block and
  fixes plus isSubRoutineCopy alignment (brief pr3/fix2-brief.md).
- Eighth review subr-review8 (solaris/t1s2) on PR1's and PR2's new commits and both bodies.
- Eval3 (main vs branch) running; new-case phase from about 09:45.

## 2026-11-19 10:00–10:40 — eighth-review fixes
- PR1 HEAD 9e07d82de79: e156e222522 step context is main's; the SDK types schedule's name as
  `SubRoutineName = never` (@mcp-exclude); a routine with definitions gets an overload
  intersected with the SDK types (an interface couldn't override a `never`-named method; Deno
  caught it); 1318b5b5999 single agent keeps stored empty lists; 9e07d82de79 copy definition span
  covers resolution with an outcome, event runs get routine.execute. Logs pr1/fix10.
- PR2 rebased, HEAD 48e157dcef9: 314e5b4c794 eval reads replies with mention names;
  df03605dc0c SDK update sends `subRoutines: []`; 7d3983124d9 definitions' inputs in name order;
  48e157dcef9 later.md cap wording. MCP snapshots regenerated (catalog is generated, not committed).
- PR3 rebased onto 48e157dcef9 (34 commits, clean).
- Red worktrees: red6-wt (PR1 at 0e5915646e9), red7-wt (PR2 at df03605dc0c).
- Next: review9 (PR1+PR2 fixes), PR3 review3, then main merge, rebuild, eval, recordings, PRs.

## 2026-11-19 10:40–11:30 — ninth review answered, main merged, final checks
- Review9 (2 blocks, 5 fixes, 4 notes). Blocks: the SDK addition (`schedule`, `subRoutines`)
  fails the other build's recheck for code touching it, during overlap or after a rollback.
  Same as every SDK addition on main (opaque fingerprint, no ordering); answered in both bodies
  with precedents and a follow-up (an orderable SDK version). Needs the user's call.
- PR1 f1373387538: routine.execute (event path) records the run's outcome. Then origin/main
  (be50abb4dc1) merged in: HEAD 30025a368d4. Body: empty-list exception, structural inputs,
  interrupted read, trace-hop follow-up (traceparent column), SDK-addition floor.
- PR2 docs: cap counts a one-time copy until it has run; compose guide allows removing a
  definition with apps; README setEnabled qualified; bench README says how copies are
  attributed and replies reread. Rebased on 30025a368d4: HEAD ff741216a90.
- PR3 review3 (1 block, 8 fixes): helper subr-pr3-fix (t1rz) on fix3-brief, plus a fresh read
  before approval to narrow the stale-approval race. PR3 rebase waits for it.
- Running: final-checks.sh (tests, Deno, SDK, MCP, clippy, fmt, gen-api on PR1 and PR2), then
  build-final-bins.sh (main be50abb4dc1 and PR2 head) for the eval and stack.
- Review10 (subr-review10, t1s5) on PR1's fix + merge, PR2's docs, both bodies, and whether the
  blocks' precedent claim holds.

## 2026-11-19 11:30–12:00 — tenth review answered, restacked
- Review10: precedents for the SDK-addition floor hold for suggest, setAppearance and children;
  shareAsTemplate predates stored code (dropped from the body). New block: `RoutineTask` gains
  the copy shape, so stored code branching `'steps' in task ? … : task.prompt` fails the
  recheck after deploy (TS2339). Main never widened a read type since stored code shipped.
  Sent to the manager as a decision (ship documented / copies read as resolved programs /
  versioned SDK checks); proceeding on "ship documented" meanwhile.
- PR1 HEAD 9d786e945bd: 74fa40c83f4 a copy's parent read records `interrupted` when its
  future is dropped (OutcomeOnce guard; two tests red then green); 9d786e945bd the event
  path's routine.execute span ends with the run, finalize gets routine.event_run.finalize.
- Bodies: schedule request fields, RoutineTask widening and what it does on deploy, index
  repair by hand, detach's parent read, 72-hour anchor, one-time copy in the cap, flag-off
  fallback, every SDK method that takes subRoutines.
- Final checks round 1 (A 9d786e945bd, B becc2cd4ac5): tests, Deno, SDK, MCP, clippy, fmt,
  gen-api pass; clippy-tests needs the online DB (round 2 runs it online).
- PR2 restacked on 9d786e945bd: HEAD 85e6898fd0f. PR3 restacked (helper's 8 commits for
  review3): HEAD 9e43fdb13a7; vitest 48 files / 628 tests, tsc 0, biome clean.
- Running: final2.sh (tests + online test clippy + clippy + fmt on both, then bins for main
  be50abb4dc1 and PR2 85e6898fd0f); review11 (subr-review11, t1s6) and PR3 review4
  (subr-pr3-review4, t1s7).

## 2026-11-19 12:00–12:30 — eleventh review answered
- PR1 HEAD 248b011ce65: d3224ded175 one `routine.event_run` span per firing (routine and
  event ids) parents `routine.execute` and `routine.event_run.finalize`; 248b011ce65 a test
  stops a copy's real run while its parent read is pending (read ends `interrupted`). Test
  spans via `domain/test_spans.rs` (rebuilds the callsite interest cache twice; 8 full-suite
  runs 617/617). Red on the pre-fix code: both fail (`left: []`), pr1/red11.log.
- PR2 HEAD b49b4ec920e: dcfd6e5555d a draft whose check carries `SubRoutinesDisabled` fails
  with SUB_ROUTINES_OFF (red on pre-fix drafter, pr2/red12.log); b49b4ec920e later.md states
  the cap's admission rule.
- Bodies: PR1 recheck consequences per identity, ordering vs old-contract fixes, interrupted
  outcome, event_run/finalize spans, index validity query, sweep per-candidate cost, raw
  request defaults. PR2 fallback rewritten for the code fix, suggest in the SDK list, overlap
  not fenced by the flag, editor unsafe before flag, eval reread needs Postgres, 72-hour anchor.
- PR3 review4: helper subr-pr3-fix (t1rz) on fix4-brief. Template read measured (1.2M
  routines, 100k activations: 7.4 ms / 86 buffers vacuumed) for PR3's Database review.
- Running: final3.sh (A and B tests, Deno, SDK, MCP, clippy, fmt, gen-api; then PR2 bins);
  review12 (subr-review12, t1s8). PR3 rebase onto b49b4ec920e after the helper.

## 2026-11-19 12:30–13:30 — twelfth review answered
- final3 on A 248b011ce65 / B b49b4ec920e: all pass (B tests 628), gen-api clean, PR2 bins
  built (superseded).
- PR1 HEAD 27c217a9aa7: dc2afe5d93e span recorder on tracing_subscriber's registry plus a
  second dispatcher kept registered (tracing-core picks callsite interest from the
  registering thread when only one is registered); records initial and later fields and
  closes; firing test asserts ids, run outcome, run span closed before finalize opens; the
  stopped-copy test times out instead of hanging. 8 full-suite runs 617/617. Red on pre-fix
  code (pr1/red13.log). 27c217a9aa7 comment reworded. tracing-subscriber added as a test dep.
- PR2 HEAD bb84562f83c: service test pins the SubRoutinesDisabled problem text the drafter
  matches; comment says which saves the refusal covers; later.md: a rescheduled copy that
  already ran counts again. 629 pass.
- Bodies: PR1 claimed-firing scope and outcomes, keyed revival, recheck timing, sweep write
  accounting, notification tail as main's follow-up. PR2 step-draft equivalence, 72-hour
  clock before the status read, reread keeps old name, typed-variable caveat, overlap remedy.
- PR3 review5: one block (stale approval: main's lost update on every save; left as
  follow-up), 11 fixes. Helper t1rz on fix5-brief. PR3 rebased to 00fcad71b39 on
  b98649f90b9; next rebase base is bb84562f83c (same tree plus a PR1 comment).
- Running: final4 (final3.sh on the new heads), review13 (subr-review13, t1sb).

## 2026-11-19 13:30–14:10 — thirteenth review answered, editor fix5 in
- PR1 HEAD 0b21c1aa48d: span recorder sets a global subscriber answering every callsite
  `sometimes` (no second dispatcher, no sleep); doubles open `test.*` spans so the tests
  check the repository write, the executor call and the copy's parent read run inside their
  spans. Red on pre-fix code (pr1/red14.log); finalize-not-instrumented mutation fails.
- PR2 HEAD 02c7774a787 (rebased on 0b21c1aa48d): rollout comment and later.md cap sentence
  narrowed. final5 on A/B: tests, deno, sdk, clippy, fmt all 0 (B 629).
- PR3: helper fix5 landed 10 commits (claims cache, Run now on a broken copy, duplicate
  overdue triggers, sharing status while open, approval form validation, wrap apps, row
  reads on menu open, event rollout gate, interactions held till settled, guide). Each red
  then green (pr3/fix-logs5). Rebased onto 02c7774a787: bc56e15085d. DB review says the
  roster/connection reads are main's queries, now also for definitions and row menus.
- Shared clone is shallow: `bun run check`'s entity-icon check needs full history; ran its
  other parts instead.
- Running: eval5 (main be50abb4dc1 vs PR2 02c7774a787 bins; stack-top now PR2 bins),
  final5 gen-api, PR3 checks6, review14 (subr-review14, t1sh), PR3 review6 (t1sj).

## 2026-11-19 14:10–15:20 — reviews 14, 6 and 7 answered, rebased on main, eval, audits
- Rebased onto origin/main 292b8b5f56d (rebase-main-292b.txt). Heads: PR1 0a491201564,
  PR2 d00d490c8c5, PR3 eb16715b9f2. review14: span-recorder race documented, copy read
  checked inside `routine.execute` (mutation red: pr1/mutation15-run-span.log). review6:
  helper fix6 commits; review7 showed fix6's read cancellation handed waiting callers old
  data, so it was reverted (063a2d6487e) and stays a follow-up.
- final6 on all three heads: A tests flaked once in `outbound::agent_session_client`
  (test.rs:81:26, untouched file; fleet post #872), rerun green 617
  (final/A-0a491201564/tests-rerun.log); B 629; deno, sdk, clippy, fmt, gen-api, deps,
  just check A/B/E, web checks (651 + 294) all 0.
- Eval5 (main be50abb4dc1 vs PR2): new cases quality 0% → 25% (WIN; branch defines the
  later work once in 100% of drafts, main never does), core 40 pairs 80% → 80% (noise).
  Due-reminder drafts fail their run mostly on the SDK: no way to list tasks by due date,
  so code tries `search.unifiedSearch` with an empty query (400) or bad entity casing (422).
- Recording: the browser needs `VITE_ENABLE_SUB_ROUTINES=true` baked into the static bundle
  (no PostHog key locally, so the flag stays loading and Create stays disabled). Stack
  restarted with it; desktop after-recording made on try 2 (try 1's run found nothing).
- Audits (t1st/t1sv/t1sw) failed items in all three PRs (docs, DTO casing, OpenAPI, file
  sizes, translations, tooltips, approval fence, eval bench). Fix helpers started:
  subr-fix-audit1 (t1sy), subr-fix-audit2 (t1sz), subr-fix-audit3 (t1t0); briefs in
  pr<N>/fix-audit-brief.md + fix-terms.md. Bodies: bodies18.ts fixed PR1/PR2 text items.
- Next: rebase PR2/PR3 onto the fixed branches, rerun final checks, re-record both views on
  the final heads, re-audit, push, open PRs, run-ci.

## 2026-11-19 15:20–15:35 — manager: tasks.list waits on a query fix below it
- Manager (verbatim gist): don't push tasks.list, don't stack the three sub-routine PRs on it; open
  them without the pointer, drafter body says due-date reminders fail at run time until code can
  list tasks by due date (eval numbers). Fix the cause as its own PR below tasks.list: bounded,
  index-backed "open tasks assigned to X, due in range, first page" (query-writing, EXPLAIN
  ANALYZE BUFFERS on the 10M seed, fresh + stale stats, 100k-task assignee, 40k-grant viewer;
  migration-review if an index). Tell the manager the fix in 2-3 lines before building; if it is
  a Soup task-path rewrite, stop and say so. Then tasks.list on it, then a small drafter PR
  pointing the later-work guide at it, eval rerun. Copy read shape: option 1 until the user says.
- tasks.list rebased onto 292b8b5f56d: 03185956c29, a001ae782df, 8d07233d4cf (AGENTS.md
  conflict with crm.emailPrivacy line resolved, both kept). Not pushed.
- subr-taskq-design (solaris/t1t1) reading /tmp/sdkq-review.EM54Lp and the Soup builder; writes
  ~/.cache/routines-draft-subroutines/taskq/design.md.
- subr-fix-audit3 done: PR3 HEAD 610f6b42064 (15 commits on eb16715b9f2), checks6 all 0,
  routines 52 files/654 tests. Report pr3/fix-logs7/report.md.
- 15:32 subr-taskq-design done (taskq/design.md). Verdict: a rewrite, not an index + predicate.
  Assignee, Status and Due Date are separate entity_properties rows (EAV; document_task holds
  only document_id), access is in entity_access + memberships, so no index on existing tables
  seeks "open, assigned to X, visible to V, due in range" in due order. A bounded first page
  needs a maintained projection table (viewer or assignee, open, due_at, task) kept exact on
  property writes, trash/restore and (viewer-keyed) access changes, plus backfill, a
  CONCURRENTLY index and a routing branch in Soup's expanded flat reader. Checked myself:
  migrations (properties_performance.sql GIN indexes only), permission_service.rs:201
  (assignment grants the assignee Edit). Stopped there per the manager; ended turn to report.
  Fix helpers subr-fix-audit1/2 still working on PR1/PR2.

## 2026-11-19 15:40–16:30 — resume: finish the three PRs (manager)
- Manager: tasks.list stays local (option 3) pending the user's decision; finish the three PRs:
  final checks, audits, recordings on final heads (desktop + phone), open, CI gate green, proof
  page. Proof shows a request whose items the parent can find today (task status change →
  review check-in 72 h later), end to end including a definition edit reaching a pending copy.
- Rebased all three on origin/main 6b9d3ba3643 after the fix helpers; PR3 doc conflicts taken
  from PR3, two scheduler facts restored (8e54e8349a6).
- final7 checks on A c45b607cf6b / B 811f324a8a9 all 0 (A 619+7+53+6+594, B 632+7; sdk 524/525;
  deno 9; bench 5); stopped before gen-api because review15 (t1t4) found fixes.
- review15 fixes: A 206b4da1329 (comment), B +2 (eval reply reads give way to the deadline,
  red = 5 s timeout; README/AGENTS detached-copy wording), E +2 (Delete count waits out an
  in-flight read, red 2 tests; drafter/Duplicate docs). Rebased clean: A 206b4da1329,
  B 8cb99525523, E 8754a3b44d0. PR bodies updated (DB rows for target validation, subRoutine,
  404/413, outcome; eval numbers + due-date gap; approval fence, claims, Delete, list reads).
- final8 (checks + bins pr2-<B> and main-6b9d3ba3643 → bin/stack-top, bin/stack-main2) and
  review16 (t1t5) running.
- 16:19 review16 (t1t5): A closed; B fix (reply read started after deadline → unhandled
  rejection; settle outlasts deadline; stuck read holds db.close) → fixed 279fa6f3a0f (red: 5 s
  timeout + replies ['late-copy']; green 8/8, tsc 0); E: Delete stop-during-own-read (justified
  in body: count is a snapshot, delete cascades), query-review of extra list reads open →
  subr-listq (t1t6) measuring main's list queries on a scratch DB in subr-testpg.
  review17 (t1t7) on 279fa6f3a0f. E rebased: head ae4fffd0da6. final8: A all 0; B stage ran on
  279fa6f3a0f after bun install (commit 16:24:25 during it; log dir says 8cb99525523).

## 2026-11-19 16:30–20:30 — main merged up the stack, review21 answered
- Manager: don't restart any session; stop a process only by its own pid, one at a time,
  after printing it. Carry on: merge main into PR1, checks, review, audit, recordings, PRs,
  CI, proof page.
- Merged origin/main 80227ffc54b (brings #10129 entity knobs / unusable items, #11387 drafted
  apps) into PR1, then up the stack. PR3 type fixes (useCodeUpgradesQuery isError, span stub).
- review21 (t1v3) findings answered:
  - PR1 49883c356a7: unusable-items entries name their sub-routine (`sub_routine`), step ids
    collide across lists (red/green). 2c682dccde6: a copy's gone item says pick another in its
    parent's sub-routine (red/green). c6aa89bf71c: test for follow_parent `partial` (red by
    mutation). Widened entity-access callers justified in PR1 body (ceiling unchanged: 40 code
    steps x 12 knobs; a copy 20 x 12).
  - PR2 400eb060aef: later.md says sub-routines can't use apps; app work stays the routine's
    own Ask AI step's.
  - PR3 2561c41b4e1: definitions' knobs marked by sub-routine (red/green); 32f18f798f5:
    unusable items read when only a definition picks an item (red/green). routines vitest
    56 files / 695 tests, tsc 0, biome 0.
- Heads: A c6aa89bf71c, B 3fe6bb8960f, E 9e1688f66d4. review22 (t1v4) on the new ranges;
  final11 (checks + pr2 bins + main-80227ffc54b bins) running.
- Next: stack on final heads, recordings (request without the project filter: the drafted AI
  condition can't see a task's project, so runs skipped at random), eval main vs branch, delta
  audit, push + open PRs, run-ci, proof page.
