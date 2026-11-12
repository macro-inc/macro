# Routine drafting eval

The yardstick for routine drafting: every change meant to make drafting faster
is judged on time and quality together, so a faster draft that drafts worse
doesn't count as a win. The target is every draft under 15 seconds, so the eval
reports the median, p90, worst and the share under 15 s, not only a median.

It runs on a local stack against the live model, one draft at a time.

| File | What it holds |
| --- | --- |
| `workspace.ts` | The person's workspace, generated the same way every time: 12 people, 32 channels, 7 direct messages, 7 projects, 14 documents, 3 databases and about 250 tasks, in near-duplicate name families (`engineering`, `engineering-archive`, `eng`). Two people are called Jordan; nothing is called marketing. |
| `cases.ts` | 20 requests close to what people type, what a good draft of each does, and for most how to run the drafted routine once and what that run must do. |
| `arms.ts` | The two ways to get a draft: `draft`, the editor's Draft it (`POST /scheduled-actions/drafts`), and `bare`, an ordinary agent chat asked to create the routine. |
| `runcheck.ts` | Putting the workspace back between drafts, and the run check. |
| `judge.ts` | The blind model judge and its rubric. |
| `trace.ts` | Reading a draft's trace from Tempo and splitting its time into phases. |
| `report.ts` | Summaries and the win, loss or noise verdict. |
| `setup.ts`, `stack.ts` | Seeding, indexing it for search, due dates and databases; the stack, sign-in, the lock, which build answers. |
| `drafts.ts` | The command line. |

## What it measures

**Time.** The `draft` arm is timed from the request to the answer; the `bare`
arm from the message to the routine existing (its turn's end is kept too).
Each draft is sent with its own `traceparent` and its trace is read back from
Tempo to split the time:

| Phase | What it is |
| --- | --- |
| setup | start to the first model call: session, admission, the first request |
| model (calls) | the model calls end to end, with their count; a pause of over a second between calls is a call the trace lost and counts as one |
| first token | median time to the first streamed chunk per model call |
| tool wait | time in tool calls with no model call running |
| hand-back | the last model or tool call ending to the answer |
| tokens | input (cached included) and output tokens per draft |

Each draft also records the load average and how many compilers were running
when it started, and each run which other stacks' harnesses were up, so a slow
draft on a busy machine can be told apart.

**Quality**, three ways, reported apart:

- *Mechanical checks* on the draft: the trigger (days, time, event), the items
  it uses by id or by a knob naming them, none of their look-alikes, the step
  kind, nothing created that it doesn't use, and leaving out a name with no
  match or two matches. In the `bare` arm asking the person instead is right
  for those two cases, if the question names the item (`asking` in
  `cases.ts`).
- *Run check*: the drafted routine is saved, fired once with a made-up trigger
  (a seeded person posts, a task changes status or is created, or it is run
  now) and its effect is read from the stack's database: the message it
  posted in the seeded channels, the task it made, its own notifications,
  what its run returned. A run whose condition wasn't met did nothing.
- *Judge*: a model that sees only the request and the routine, with a glossary
  of the ids in it, grades it 1 to 5 (`RUBRIC` in `judge.ts`); 4 or 5 is a
  draft the person would keep.

The headline quality number is the share of drafts that pass every mechanical
and run check.

A draft the eval itself couldn't finish (a dropped connection, a harness
restarting) is tried once more after ten seconds. A second failure is recorded
as an error: it fails quality, is left out of the timing, and the summary
counts it under `errors`. The judge is a second opinion: `calibrate` measures how often it
agrees with grades given by hand.

## Run it

Any local stack works: `--instance` names it (default `drafting`), and
`seed` adds the eval's people on their own domain without touching anything
else. The stack's database must have every migration of the builds it runs: a
harness newer than its schema answers 500 on routine save and list, so the run
checks and the `bare` arm fail. It must save event routines
(`EVENT_ROUTINES_ENABLED`): with them off every event-triggered draft's check
fails, so `run` stops before drafting. A debug-build document storage service
needs `RUST_MIN_STACK=8388608` or it dies on database queries. The seed CLI
writes rows straight to the database, so search never hears of them: `seed`,
and every run when name search can't find a seeded document or project,
backfills the seeded workspace through the stack's
`search_processing_service`. Without it every by-name lookup of a document or
project fails, as it wouldn't for a real person.

```bash
B=crates/scheduled_action/bench
nix develop --command bun $B/drafts.ts seed --instance drafting      # seed again to reset the workspace
nix develop --command bun $B/drafts.ts run --label main --arm draft --rounds 3 --out /tmp/main.draft.json
nix develop --command bun $B/drafts.ts run --label main --arm bare  --rounds 3 --out /tmp/main.bare.json
```

`--cases a,b` runs some cases, `--model` picks the drafting model (default
`anthropic/claude-sonnet-5-5`, what paid users draft on), `--no-run-checks`
and `--no-judge` skip those (a run check holds the stack for up to four
minutes), `--append` keeps a results file: it first fills the drafts missing
from the rounds it has, then adds `--rounds` more. And `TEMPO_URL` (default
`http://localhost:3200`) is where traces are read. Seed again when the seed
is more than a few days old: requests read "this week" and "due today".

Drafts on one stack never overlap, whoever starts them: each takes a lock in
`~/.cache/routines-eval/locks/` for the draft, its run check and putting the
workspace back. Before and after each draft every routine is deleted, and the
databases, documents, tasks and messages nobody seeded are removed.

### Comparing two builds

The model's speed drifts over a day by more than most changes save, so builds
are compared on interleaved rounds. `ab` swaps the stack's harness between two
builds (A then B, then B then A, ...), holding the stack for each segment,
and puts back the harness the stack ran before when it ends. Run again with the
same `--dir` and it fills the gaps a stopped run left:

```bash
mkdir -p ~/.cache/routines-eval/bin/mine && cp -l target/debug/agent_harness_service ~/.cache/routines-eval/bin/mine/   # keep the build still
nix develop --command bun $B/drafts.ts ab --arm draft --rounds 4 --dir /tmp/eval \
  --a main --a-bin ~/.cache/routines-eval/bin/main-<sha> --b mine --b-bin ~/.cache/routines-eval/bin/mine
nix develop --command bun $B/drafts.ts compare /tmp/eval/main.draft.json /tmp/eval/mine.draft.json
```

`compare` prints both summaries, each case, and the verdict of the last file
against the first:

- **time**: the median of B's time over A's across pairs of the same case and
  round, with a 95% bootstrap interval; a win or loss only when the interval
  leaves 1.
- **quality**: the share passing every check may not fall by more than
  `QUALITY_MARGIN` (`report.ts`), what main against main moves by at this size;
  a bigger fall is a loss whatever the time.

`harness --bin <dir>` points the stack at one build; `reread` checks results
again after a change to the checks (`--traces` reads the traces again,
`--judge` grades again).

If every draft prints `no trace`, the stack isn't exporting: when the shared
collector restarts it drops off the instance's network, and the harness logs
`dns error` exports. Reattach it with
`docker network connect --alias otel-collector macro-drafting_services <collector>`
(the container publishing port 4318), or restart the stack.
