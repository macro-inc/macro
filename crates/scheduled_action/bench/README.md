# Routine drafting benchmark

Times AI routine drafting (`POST /scheduled-actions/drafts`, `src/domain/drafts.rs`)
on a local stack against the live model, and checks each draft is still a good one.

- `cases.ts`: the fixed requests (new routines, a code-less Ask AI routine, a step
  to add, a step to change) and what a good draft of each does.
- `scenario.json`: the seed scenario the requests run in. Riley, an individually
  paid user, owns three channels, a project, tasks and unread email; there is no
  `#marketing` channel, so one case checks a draft leaves out what it can't match.
- `drafts.ts`: runs the cases and compares runs.

Each draft is sent with its own `traceparent`. The benchmark then reads that trace
from Tempo and splits the server's time (the `routine.draft` span) into:

| Phase | What it is |
| --- | --- |
| first pass | draft start to the end of its first passing check: when an answer existed |
| setup | draft start to the session's first model call: session, admission, the first request |
| model | the session's model calls (`chat_streaming` spans), with their count, tokens and time to first chunk; a pause of over a second between calls is a call the trace lost (it happens to long ones) and counts as one |
| tool wait | time in the session's tool calls (`execute_tool <name>` spans) with no model call running; a tool call starts while its input streams |
| tail | the last model or tool call ending to the answer: waiting, stopping, settling, cleanup |
| other | the rest: gaps between turns |

Checks (`routine.check`) reach the harness from the session's code without the
draft's trace context, so they land in traces of their own; the benchmark finds
them by time, which is why it runs one draft at a time. The opener's side model
call runs beside the first turn and is left out.

## Run it

```bash
just run_local --instance drafting   # needs model keys in Doppler (lcl_personal)
just seed-scenario --instance drafting apply --file "$PWD/crates/scheduled_action/bench/scenario.json"
nix develop --command bun crates/scheduled_action/bench/drafts.ts run \
  --label main --runs 3 --out /tmp/drafts-main.json
```

`--cases a,b` runs some cases, `--model` picks the model (default
`anthropic/claude-sonnet-5-5`, what paid users draft on), `--instance` the stack,
and `TEMPO_URL` (default `http://localhost:3200`) where traces are read. Runs go
round-robin over the cases, so a slow stretch of the model's day spreads across
all of them. Results are written after every draft; `--append` adds rounds to
an earlier results file of the same build.

Compare two runs (medians, with wall time's min–max, and how many quality checks held):

```bash
nix develop --command bun crates/scheduled_action/bench/drafts.ts compare \
  /tmp/drafts-main.json /tmp/drafts-branch.json --out /tmp/drafts.md
```

`reread <results.json>` judges a results file's drafts and reads its traces
again, after a change to the checks or to how traces are split
(`--quality-only` skips the traces).

Each result keeps every draft whole, so drafts can be compared side by side. The
quality checks are mechanical (trigger, ids used, step kind, nothing unused);
read the drafts too.

If every draft prints `no trace`, the stack isn't exporting: when the shared
collector restarts it drops off the instance's network, and the harness logs
`dns error` exports. Reattach it with
`docker network connect --alias otel-collector macro-drafting_services <collector>`
(the container publishing port 4318), or restart the stack.
