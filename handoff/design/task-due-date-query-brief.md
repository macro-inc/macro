Work out, without building it yet, how to make one task query bounded and index-backed. The
routines manager's words, verbatim:

> Fix the cause as its own PR, below tasks.list: make "open tasks assigned to X, due in a range,
> first page" bounded and index-backed (query-writing skill, EXPLAIN ANALYZE BUFFERS on your 10M
> seed, fresh and stale statistics, the 100k-task assignee and the 40k-grant viewer). If it needs
> an index, that is a new migration with migration-review. Before building, tell me in two or
> three lines what the fix is (index, query shape, whether the web's Due soonest gets it too) so
> I can tell the user what is coming; if it turns out to be a rewrite of Soup's task path rather
> than an index and a predicate, stop and end your turn with that.

Background:

- `macro.tasks.list` (branch `synoet/sdk-list-tasks-by-due-date`, checkout
  `~/.herdr/worktrees/macro/synoet-sdk-list-tasks-by-due-date`, unpushed, three commits on
  `292b8b5f56d`) posts the same document-storage Soup query as the web Tasks view's My tasks with
  "Due soonest" (`apps/web/src/features/tasks-view/queries/task-query.ts`): Assignees = X, the
  open Status options OR'd, a `dr` due range with `et: 'TASK'`, sorted by the due date property.
  The SDK side is in `packages/sdk/src/entities/tasks/`.
- Its query review blocked it: on a 10M-document seed (PostgreSQL 18.6; production is 14.22,
  without B-tree skip scans) a 100k-task assignee hit the 60 s cutoff on every first page in all
  four request shapes, and a 40k-grant viewer replay took 180 s. The cost is the candidate work
  before the limit. All its evidence is in `/tmp/sdkq-review.EM54Lp/` (`README.txt` first;
  `sql/` has the verbatim SQL, `plans/{fresh,stale}/` the plans with parameters, `metrics.csv`,
  `scan-nodes.csv`, and the seed SQL `aux-seed.sql`, `background*.sql`, `finish-seed.sh`). Don't
  run any `.py` file there.
- A routine can call this every minute; the web's My tasks never does. So the bound has to hold
  per call, not only on average.

What I need back, first and fast (from the evidence and the code, no new seed):

1. Where the time goes in the slow plans (node, rows, loops), and which part of the Soup SQL
   builder in document storage produces it (file and line).
2. The fix you'd build: the index (exact DDL, table, columns, partial predicate, built
   `CONCURRENTLY` in its own migration), the query shape that uses it (what changes in the
   builder, and for which filter shapes only), and how it stays bounded for the 100k-task
   assignee and the 40k-grant viewer (where the access check runs relative to the limit).
3. Whether the web's My tasks "Due soonest" takes the same path and gets the fix too.
4. Your verdict: an index plus a predicate or query-shape change in the existing builder, or a
   rewrite of Soup's task path. Say which plainly, with the reason.
5. The production-size risks: index size and build time at production row counts you can find
   (`infra/stacks/macrodb`, the query-writing skill's tiers), writes it adds, and what the
   PostgreSQL 14 planner may do differently.

Write that to `~/.cache/routines-draft-subroutines/taskq/design.md` and end your turn.
Read the repository's `CLAUDE.md`, `CODING.md`, the `query-writing` and `migration-review` skills
(`.agents/skills/`), `.agents/rules/rust/db.md` and the document storage service's `AGENTS.md`
first. Make no commits and no edits in any checkout. Write no Python, not even a one-off; use
shell, jq, SQL, Rust or TypeScript. Don't start or touch any running stack, container or
browser. The only database you may use is the local Postgres at `localhost:28699`, and only a
scratch database you create there yourself (never `macrodb` or `subr_plan`); you shouldn't need
one for this step.
