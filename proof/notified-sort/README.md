# Notified-sort differential

Runs Home's notified lists through main's reader (REST) and the branch's reader
(GraphQL `Soup` with `NOTIFIED_AT`) side by side, on the same synthetic data at
the same time, and compares what they return and what Home shows.

```sh
PROOF_OLD_WORKTREE=<worktree at the merge-base> proof/notified-sort/run.sh all
```

`run.sh` documents its modes, seeds and environment. It needs a `run_local`
stack instance and both worktrees installed (`bun install`). Each run writes
`out/<run>/` (summary, every read, DOM compare, step and sequence) and
`report.ts` prints a verdict per run from `out/*/summary.json`.

| File | What it does |
| --- | --- |
| `run.ts` | One run: seed a world, start both apps and one browser, run the read, DOM and sequence phases, optionally under load or with a planted mutant. |
| `probe.ts` | Loaded into each app's dev server; reads a list through the app's own query code and reports a normalized snapshot. |
| `lib/world.ts`, `lib/setup.ts` | The synthetic world per seed: viewers, entity kinds, access (owner, member, team, public, revoked, deleted), sizes and odd values. |
| `lib/gen.ts` | Read cases per seed: sources, filters, sorts, page sizes, grouping. |
| `lib/actions.ts` | Write steps for sequences, through the services a client would call. |
| `lib/compare.ts`, `lib/classify.ts`, `lib/dom.ts` | Data-level and Home DOM comparisons, difference classes, reference reads. |
| `lib/closed.ts` | Every known difference class, with its cause at file:line and why callers never see it. |
| `lib/mutants.ts` | Faults planted in the branch's reader to show the harness catches them. |
| `dbg-*.ts` | Minimal repros behind the closures. |
