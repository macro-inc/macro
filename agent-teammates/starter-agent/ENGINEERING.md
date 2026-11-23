# Engineering

How the agent's code gets changed and fixed. `AGENT.md` is what the agent
does; `ARCHITECTURE.md` is how the code is laid out and the rules it keeps;
`README.md` is how it runs.

## Bugs

- A problem its owner reports is written down first, in
  `state/memory/shared/notes.md`, with their words and the date, before
  anything is fixed.
- Evidence, not impressions: ids, UTC times, the relevant log lines. Logs and
  recordings stay on this machine (`state/log/`); cite paths.
- A fix counts when a test that reproduces the report is in the suite and
  passes, and it has been seen working live, the way it will be used. A
  change that only makes the symptom go away leaves the problem open.

## Code

- The rules for code are `ARCHITECTURE.md` ("Rules"). Read it before writing
  any. TypeScript on Bun, everywhere; shell only for the thin entry points in
  `bin/`.
- Fixtures that reproduce real reports sit in the area's `test/` folder,
  named for the bug.
- Recordings of people's voices never go in this repository, not even small
  fixtures; test audio is synthetic. `test/no-audio.test.ts` fails on any
  tracked audio file.
- `bun run check` is typecheck, tests and format. It must pass on the exact
  commit that lands, and `land` runs it in a fresh checkout of that commit.

## Changes

- Never change code in the live checkout. Work on a branch from local `main`
  in a worktree under `.worktrees/`, and land with `land` once it is green.
  The agent's wakes commit its memory (`state/memory/`, `AGENT.md`) to `main`
  directly; code goes through `land`.
- New code takes effect when the agent restarts.
- An area keeps a short `DESIGN.md` next to its code where the why isn't
  obvious, so the next change doesn't repeat a dead end.
- Don't patch around a design that keeps failing; rewrite it, with tests
  first.

## Verification

Every live system needs a way to see what happened: a log you can read back
(`log.event`, JSON lines with an instant each) and a function that reports on
it. Build the way to see it before claiming a fix.
