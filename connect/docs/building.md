# Building with agents

## Roles

| Role | Model | Does |
| --- | --- | --- |
| Planner | Claude Opus 5.5 (Claude Code) | Runs `connect-pm`: writes task specs, dispatches builders, reviews and merges their branches, keeps `STATUS.md` true. Writes no product code itself. |
| Builder | GPT-6-Sol on the Fast tier (Codex CLI, `gpt-6-sol`, `service_tier = "priority"`) | Implements one task spec in its own worktree and branch, runs the task's checks, reports in the spec. Leaves changes uncommitted: Codex's sandbox keeps `.git` read-only. |

Eric chose this split on 2026-10-30 ([decisions](decisions.md)).

## Task specs

One file per task: `connect/tasks/T<NNN>-<slug>.md`, committed before
dispatch so the builder's worktree has it. Sections:

- **Goal**: the outcome, in one paragraph.
- **Context**: files and docs to read; prior art to mine.
- **Do**: the work, concrete enough that a builder makes no product decisions.
- **Done when**: checkable criteria, including the exact checks to run.
- **Out of scope**: what to leave alone.
- **Result**: left empty; the builder fills it (what changed, each check and
  its outcome, open questions).

## Dispatch

```sh
connect/tooling/dispatch.sh connect/tasks/T001-cargo-boundary.md [base-ref]
```

The script adds a worktree on branch `connect/T001-cargo-boundary` from
`base-ref` (default `HEAD`), runs the builder there in Codex's
`workspace-write` sandbox with network access, and writes the event log next to
the worktree. Builders read `AGENTS.md` files natively; the shared brief is
[`../tooling/builder-brief.md`](../tooling/builder-brief.md).

## Review

The planner reviews every builder branch before it merges into the
integration branch:

1. Read the spec's Result and the diff (`git diff <base>...connect/T<NNN>-*`).
2. Re-run the spec's checks; a check the builder reports as passing must pass.
3. Check the diff against the spec's Out of scope and the boundary rules.
4. Commit the work on the builder's branch in logical pieces (the Result
   proposes messages), crediting the builder, then merge with `--no-ff`; or
   add a "Review (planner)" section above the Result in the builder's
   worktree copy of the spec and run `dispatch.sh` on it again: it resumes in
   the same worktree.
