# Handoff: routine sub-routines defined once, scheduled as copies

Stopped on 2026-11-19 for a machine move, at a safe point: every branch below is
committed and pushed, nothing is mid-merge, and no PR is open for the stack.

## The work

A routine can define per-item later work once (`subRoutines: [{ name, title, inputs, steps }]`)
and its code steps schedule copies (`macro.routines.schedule(name, { trigger, inputs, key })`).
A copy stores only `{ sub_routine, inputs }` and runs the parent's definition as it is at run
time, so editing the definition changes every copy that hasn't run. The drafter writes
routines this way; the editor shows and edits definitions and copies.

Three stacked branches, merge order bottom up. Titles and bodies are ready in `pr-bodies/`.

| # | Branch | Head | Base for the PR | PR title |
| --- | --- | --- | --- | --- |
| 1 | `synoet/routines-sub-routine-definitions` | `c6aa89bf71c` | `main` | `feat(routines)!: define sub-routines once and schedule copies that run them` |
| 2 | `synoet/routines-draft-sub-routine-definitions` | `3fe6bb8960f` | branch 1 | `feat(routines): draft later work per item as a sub-routine defined once` |
| 3 | `synoet/routines-sub-routine-editor` | `9e1688f66d4` | branch 2 | `feat(routines): show and edit sub-routine definitions and their copies` |

Each upper branch holds merge commits of the one below; main `80227ffc54b` is merged into all
three (origin/main has moved 7 commits since). Merge main bottom up when it conflicts.

Other branches:

- `synoet/routines-draft-subroutines` (`38df4c58b1d`): the first attempt, PR #11357, closed as
  superseded. Untouched; its two eval cases and their run check live on in branch 2.
- `synoet/sdk-list-tasks-by-due-date` (`8d07233d4cf`): `macro.tasks.list` by due date. Pushed so
  it survives; not for a PR. Held pending a decision: a bounded, index-backed query needs a
  maintained projection table over task properties (`design/task-due-date-query.md`). Until
  then the drafter PR says due-date reminders fail at run time.
- `synoet/routines-draft-subroutines-wip`: branch 3 plus this `handoff/` folder. Not for a PR.

## Decisions already made (don't reopen)

- Copies reference the definition (A'): a copy's page shows the parent's definition;
  "Keep as my routine" copies the steps out first.
- A copy's task in the SDK is `{ sub_routine, inputs }` (copy read shape option 1).
- `tasks.list` stays off the stack until the projection-table decision.
- Deploy in two steps behind `enable-sub-routines` (PR 1 body, "Deploy").

## What is proven, and on which commit

- Branch 1 at `c6aa89bf71c` (`checks/final11-run.txt`, stage A): Rust tests (scheduled_action
  lib 595 and the other suites), Deno harness, SDK tests, tsc, lint, coverage, MCP (18), bench
  tsc, clippy, fmt all pass. `bench-test=1` is expected there: branch 1 and main have no bench
  test files (the eval test arrives with branch 2). Not run at this head: gen-api check,
  `cargo x deps --check`, `just check`, `just pr-privacy` (the run was stopped for the move).
- Branch 2 at `400eb060aef` (its last code commit; `3fe6bb8960f` only merges branch 1):
  drafts tests 93 passed.
- Branch 3 at `32f18f798f5`: routines vitest 56 files / 695 tests, tsc 0, biome 0.
- Review 22 (`reviews/review22-report.md`) on all three heads: no block; scheduler 555 and
  drafter 569 lib tests and web vitest 696 passed in detached copies; each new test fails with
  its fix removed.
- Every fix answering review 21 has a red run (fix removed) and a green run; the logs stayed on
  the old machine, and the worklog lists them.
- Last complete drafting eval: `eval/eval5-*` (main `be50abb4dc1` against branch 2 at
  `02c7774a787`): core 20 cases x 2, 80% -> 80% (no change, margin 13%); the two new cases x 4,
  0% -> 25%; `review-check-later` passes its run check 2 of 4 on the branch, `due-soon-reminders`
  0 of 4 (the due-date gap). Must be rerun on the final heads.

## Open review findings (review 22)

- Branch 2, fix: `finding/later.md` routes app work for later items to the routine's own Ask AI
  step "on the routine's schedule", but an event-only routine has no later firing. Tell the
  drafter to switch to a periodic scan when the item can be found again, or to say the timing
  can't be met.
- Branch 3, fix: the detail page now reads unusable items when only a definition picks an item
  (up to 396 item checks per request; shared-document access walks grants and attachments).
  Measure on a production-sized scratch database or justify in the PR 3 body's Database review.
- Branch 3, note: `routine-detail-definitions.test.tsx` passes with the routine-level filter
  removed; give both steps the same item so it can fail.
- Branch 1, note: `crates/scheduled_action/AGENTS.md` (~line 226) should say a failed copy sends
  the owner to the parent's sub-routine, not the routine settings.

## What is next

1. Answer the review 22 findings above, then rerun `checks/final11.sh` on all three heads
   (tests, clippy, fmt, SDK, gen-api, deps, `just check`, pr-privacy, web checks) and build the
   final binaries (main and branch 2) for the stack and the eval.
2. Delta audit (the `audit` skill) on the final heads.
3. Recordings on the final heads, desktop and phone, before (main) and after: draft, review in
   the editor, save, fire the trigger, the copy it scheduled, edit the definition on the parent,
   the edit showing on the pending copy, run the copy and see the edit in its reply.
4. Drafting eval main against branch 2 on the final heads (`scripts/eval/eval6-run.sh`), then
   update the eval numbers in the PR 2 body.
5. `just pr-privacy` with each title and body, push, open the three PRs ready for review
   (1 -> main, 2 -> 1, 3 -> 2), add `run-ci` (a stacked PR's base goes to main for the run and
   back after), CI gate green on each latest commit. Never merge.
6. Proof page from `proof/index.template.html` (placeholders in angle quotes), replacing the old
   page from #11357.

## Traps

- Recording request: use one without a project filter, e.g. "Whenever a task moves to In review,
  check on it three days later and tell me if it is still in review." The drafted AI condition
  can't see a task's project, so a project filter made runs skip at random. `ui/record3.ts`
  reads `TEXT` from the environment; `ui/rec4.sh` doesn't forward it yet.
- The local stack needs a PostHog stand-in (`scripts/stack/Caddyfile`, `flags.json`) with
  `enable-sub-routines` on, and the web build with `VITE_ENABLE_SUB_ROUTINES=true`; without
  PostHog the editor's Create stays disabled.
- Switching one stack database between branch and main needs `sqlx migrate run
  --ignore-missing` (`scripts/stack/sqlx-shim.sh` on PATH); the document storage service needs a
  larger `RUST_MIN_STACK` (`extra.override.yml`, `dc.sh`).
- Query plans go in a scratch database created and dropped for the purpose on the test
  Postgres, never in the stack's databases.
- `bun`, `docker` and `psql` only work inside `nix develop`; source `scripts/stack/env.sh`
  inside the shell (it sets the cargo target and the test database URL, which the shell resets).
- The scripts here are copies from the old machine: paths use `$HOME`, `$C` (the work cache)
  and `$S` (the session scratchpad) and need adapting.

## Not committed (left on the old machine)

Built binaries (about 58 GB), the main checkout used for baselines (11 GB), reviewers'
scratch trees (about 45 GB), raw test logs of every red/green run, raw eval drafts
(`*.draft.json`), UI recordings and screenshots (made on older heads; they must be redone
anyway), seed logs, review and audit reports before 21 (all answered), and the seeded user's
browser session file (it holds tokens).

## Files

- `pr-bodies/`: the three PR bodies.
- `reviews/`: reviews 21 and 22 (22 is open), the last full audit, the list-query measurement.
- `design/`: the due-date task query design and its brief.
- `checks/`: the final check script and its last run; the terms given to fix helpers.
- `eval/`: the last complete eval reports and run log.
- `scripts/`: stack, UI recording and eval scripts.
- `proof/`: the proof page template.
- `worklog.md`: the full work log, newest at the end.
