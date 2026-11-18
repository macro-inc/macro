# Suggestions bench

The yardstick for suggestions: change a prompt or a tool, run one section, and
learn whether its suggestions got better, worse or stayed within noise. Each
section runs the real generation on a local stack against the live model, for
synthetic people, and scores what it wrote against each person's answer key
with one number and its parts underneath.

| File | What it holds |
| --- | --- |
| `bench.ts` | The command line and the sections. |
| `personas/` | The tune personas: `workspace.json` (a seed scenario without mail), `inbox.json` (100 messages as Gmail lists them, labels included), `feed-truth.json` and `routines-truth.json` (the answer keys). |
| `personas.ts` | Loading personas, the `full` and `signup` copies, the seed scenario and the stand-in's mailbox. |
| `clock.ts` | Moving every date in a persona to the day the bench runs. |
| `stub.ts` | The stand-in for PostHog and the provider mailbox. |
| `run.ts` | One generation: seed, start, watch, read back, cost. |
| `judge.ts` | The model judges and their rubrics. |
| `catalog.ts` | The routine catalog, read from `routine_program`'s `catalog.rs`, and the check that each answer key places every routine. |
| `score.ts` | Scores, summaries and the win, loss or noise verdict. |
| `report.ts` | The summary table. |
| `heldout.ts` | Writing held-out personas and the ledger of their use. |

It shares `stack.ts` (the stack, sign-in, the per-stack lock) and `seedId`
with the routine drafting eval in `crates/scheduled_action/bench/`, and
otherwise stands apart from it: that eval drafts one routine from a request,
this one judges what a whole generation suggests unasked.

## Sections

Suggestions on main come from generations (`crates/suggestion_generation`):
a suggestions session that writes the feed's cards (prompt, entity and
routine cards) and routines sessions that write routine suggestions (catalog
picks and drafted routines). Each section runs one kind alone, with only its
flag on, so its number moves only with that kind's prompt and tools. Both
also turn on `enable-event-routines` (`BASE_FLAGS`), without which a drafted
routine can't start when mail arrives; every other flag is off.

| Section | Generation | Persona copy | Answer key |
| --- | --- | --- | --- |
| `routines` | onboarding (`POST /suggestions/generate`), `enable-routine-suggestions` only: the routines sessions of the onboarding layout, in parallel, 240 s cap, one retry when a session suggests nothing | `signup`: the person a minute after signing up, their mailbox and nothing else | 5 or 6 needs a routine would meet (which catalog keys meet each, or what a drafted routine must do), 4 or 5 decoys, and every other catalog routine placed as `fine` or `misfit` |
| `feed` | fresh suggestions (`POST /suggestions/regenerate`), `enable-suggestions` only: the suggestions session with nightly timeouts | `full`: weeks of use, with documents, tasks, channels, calls and mail | 9 planted opportunities that connect sources, and 3 stale decoys |

The nightly run is the manual one with another brief line, a paid-plan check
and the 2–5 am window, so `feed` stands for both. The weekly routines review
(nightly or manual with both flags on, routines due) is not a section yet; see
"Adding a section".

### What a section scores

Each attempt scores **100 × (found − bad) / needs**:

- *found*: needs (routines) or planted opportunities (feed) that at least one
  suggestion meets. A broken, unsafe or misfit routine meets nothing.
- *bad*: suggestions with anything wrong. Routines: a decoy, misfit, broken,
  a bad knob, the wrong sidebar first, a duplicate, unsafe, or a reason that
  invents a fact. Feed: a decoy, stale, a duplicate, unsafe, or invented.
- A fine suggestion the key didn't plant counts nothing.

A catalog pick is scored from the answer key and the catalog alone, so the
same pick scores the same every time: the key places each of the catalog's
routines once, as meeting needs, as a decoy, `fine` or `misfit`; a pick is
in the wrong sidebar when its first one isn't among the routine's surfaces,
and a duplicate when an earlier pick has its key. Only what the session
wrote for it is the judge's: a reason that invents a fact, and the knobs it
set (bad or breaking it). A drafted routine and a card are the judge's call
throughout. Judged twice, the baseline's generations of 2026-11-18 differed in
routines' *bad* by 0.82 a generation (root mean square), mostly misfit and
sidebar calls on catalog picks; scored by key, by 0.41.

So finding everything with nothing wrong is 100, suggesting nothing is 0, and
noise drives it below 0. A generation the build fails (a server error
starting it, or still running at the deadline: 12 minutes at onboarding, 25
on request) scores 0; a failure of the bench's own (seeding, the stand-in,
the judge) leaves the attempt out and is listed under the table. Underneath, each run reports found / needs, bad,
invented, wrong by reason, suggestions made, a quality mean (the judge's
1–5 *keep* for routines, *worth* for cards, and a 1–10 feed rating), time to
the first suggestion and to the end, and the generation's cost from
`ai_usage` (non-billable, still recorded). The judge's own cost is reported
apart: it calls as a grader account of its own.

The judge (`anthropic/claude-opus-5-5` through the stack's structured
completion) sees the persona's mail or workspace, the answer key and the
suggestions, never the build, the label or other runs, and gets the run's own
"now" and time zone.

## Running it

Once per machine: a stack from this checkout with the bench's env file, which
points PostHog and email_service's provider route at the stand-in.

```sh
\cd "$(git rev-parse --show-toplevel)"
nix develop --command just run_local --instance sugbench --no-frontend \
  --env-file crates/suggestion_generation/bench/stack.env
```

Then, inside `nix develop` (it has `bun` and `docker`):

```sh
B=crates/suggestion_generation/bench
bun $B/bench.ts run routines --label main           # one section at its default size
bun $B/bench.ts run feed --label main --seats 1 --reps 1   # a quick look: one attempt a persona
bun $B/bench.ts all --label main                    # every section
bun $B/bench.ts compare <main run.json> <mine run.json>
bun $B/bench.ts report <run.json>...
bun $B/bench.ts rescore <run.json>...               # after changing an answer key: free, no model calls
```

A section's default size is 3 personas × 3 seats × 3 reps: 27 attempts. A
seat is a copy of a persona under a domain of its own (`founder`,
`founder/s2`, `founder/s3`), a person of its own, so all nine copies
generate at once and a rep takes about as long as one attempt. Seats sign
up on their first run (one signup each for `routines`, five for `feed`'s
teams), against the webhook's 50 an hour. Judging runs alongside, as three
grader accounts, while the next rep seeds.

Each run writes `~/.cache/suggestions-bench/runs/<label>-<section>-<set>-<time>/run.json`,
with each attempt's suggestions, the judge's marks, the score and the
sessions' transcripts beside it. `run` starts the stand-in if it isn't up
and holds the stack while it runs (the drafting eval's lock), so two runs
never share it.

To compare a change: run main, switch the stack to your build (`just
run_local --instance sugbench ...` from your branch, or reload the harness),
run the same section with another `--label`, then `compare`. A difference
inside the section's margin (`MARGINS` in `bench.ts`) is noise.

### Noise

`compare` takes, for each persona both runs have, B's mean less A's, and
averages over personas; its 95% interval is that ± t standard errors, from
how much each persona's attempts spread on each side. It calls a change a
win or a loss only when the score moved past the section's margin
(`MARGINS` in `bench.ts`: how far two runs of main land apart at the
default size) and the interval leaves zero. *found* and *bad* get the same
test against margins of their own, and show a change in one before the
score can. Measure the margins again after changing the personas, the
judge or the default size:

```sh
bun $B/bench.ts run routines --label main-a && bun $B/bench.ts run routines --label main-b
bun $B/bench.ts noise <main-a run.json> <main-b run.json>
```

A side of `compare`, `noise` or `report` may be several runs of one section
joined by commas (`a1.json,a2.json`), read as one. The margins hold at the
default size: a smaller run (fewer seats or reps) is only a look.

### Held-out personas

Tune on `personas/`. To confirm a change on people nobody tuned against,
write a fresh set and run both sides on it once:

```sh
bun $B/bench.ts heldout make h1 3       # 3 new personas, written by the model, in ~/.cache/suggestions-bench/heldout/h1
bun $B/bench.ts run routines --set h1 --label main
bun $B/bench.ts run routines --set h1 --label mine
bun $B/bench.ts heldout list            # how often each set was read
```

Writing a set takes about 15 minutes and $3 a person (Opus 5.5, about 22
short model calls each, since the stack gives one 90 seconds). If one still times out, `heldout make`
says which people are missing; run the same command again to write just
those.

Held-out sets live outside the repository and are reported only in
aggregate. A set written before keys placed every catalog routine (`h2`
and earlier) can't be read by the `routines` section: write a new one. Don't open their files while tuning. Each run is recorded in the
set's ledger; after a baseline and one candidate a set is spent and the bench
says so: make a new one.

## Baseline

Main (`c59b249582`) with the bench on top, two runs of each section at the
default size, on one local stack, 2026-11-18. Each row is 9 attempts; the
score's range is its 95% bootstrap interval, times are medians.

| Section | Run | Score | Found / needs | Bad | Invented | Suggested | First | End |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `routines` | A | -2.2 (-20.7 to 16.3) | 2.78 / 5.7 | 2.89 | 0.11 | 13.0 | 44 s | 186 s |
| `routines` | B | -19.3 (-54.4 to 15.9) | 2.78 / 5.7 | 3.89 | 0.22 | 13.4 | 48 s | 146 s |
| `feed` | A | 76.5 (67.9 to 85.2) | 7.44 / 9 | 0.56 | 0.33 | 11.7 | 166 s | 305 s |
| `feed` | B | 69.1 (61.7 to 76.5) | 6.56 / 9 | 0.33 | 0.11 | 11.6 | 201 s | 317 s |

Noise (`MARGINS`): `routines` moved -17.0 between the runs (95% -37.0 to
3.3), so its margin is 37; `feed` moved -7.4 (95% -17.3 to 2.5), margin 17.
Routines' swing is almost all in *bad*: every attempt met every need a
catalog routine can meet and few that need a drafted one, while the number of
misfit catalog picks varied from run to run, most for the plumber. A routines
change has to move the score by about 37 points before `compare` calls it;
its parts (found, bad) show smaller moves first.

## Cost and time

From the baseline runs. A generation's cost is its `ai_usage`; the judge
(Opus 5.5) costs about as much again.

| Section | Generation | Judge | One run (9 attempts) | Wall time of a run |
| --- | --- | --- | --- | --- |
| `routines` | $0.22 | $0.21 | about $3.90 | about 15 minutes |
| `feed` | $0.17 | $0.29 | about $4.20 | about 22 minutes |

A comparison is two runs (about $8 and 30 to 45 minutes for one section);
`all` runs both sections in about 40 minutes. The stand-in and the stack
cost nothing beyond the model calls.

## How it works

- **Dates.** Each persona was written for one evening, 2026-11-08 20:00 UTC.
  The bench seeds its mail as old as it was then and moves every date in the
  text, weekdays too, by the whole days since (`clock.ts`), so a run on any
  day sees the same week. Month names and quarters stay as written.
- **The stand-in.** One Caddy container (`stub.ts`) on the stack's network,
  under the name `stack.env` points at: PostHog's `/flags` answers with the
  section's flags, and email_service's `/internal/recent_messages/{user}`
  answers with the persona's mailbox (the routines brief reads it from Gmail
  or Outlook, which seeded mail never reaches); everything else goes to
  email_service. The suggestions service trusts a flag for a minute, so the
  bench waits a minute after changing them.
- **Clean runs.** Every attempt seeds its persona again with the seed CLI's
  `apply`, which replaces the persona's seeded rows. A person signs up
  through the signup webhook on their first seed and keeps that account (the
  bench waits for a first signup's support channel, which lands with the last
  of its sample content, and stops if the webhook refused the person's
  signup); signing up anew
  each time would pile up a support channel and a billing customer per
  attempt. The bench waits out a generation an earlier attempt gave up on,
  until the harness has ended and deleted its sessions (up to 25 minutes
  after a killed run),
  then deletes what earlier generations left: the person's rows in every
  suggestion and routine suggestion table (read from the catalog) and their
  mailboxes' drafts (`apply` already replaces the seeded mailbox), and checks
  none are left before it starts. Sessions delete their logs when they end, so the bench copies
  `agent_session_log` while they run (the last lines can be missed).
- **Parallel personas.** A rep seeds every persona, then runs their
  generations at once (`--concurrency`, default 3); the feed section indexes
  the seeded items for search first.

## Adding a persona or a section

- A persona is a folder in `personas/` with the four files; its addresses end
  in `.example` and street addresses and phone numbers are written so the
  privacy scan doesn't read them as real ones (`Calder St #220`, `415 555 01 42`).
  `routines-truth.json` needs come from steady streams in the mail; list the
  catalog keys that meet a need on their own, the ones that are a decoy, and
  every other catalog routine in `fine` or `misfit`.
- A catalog routine added, renamed or removed in `catalog.rs` stops the
  `routines` section until every answer key places it again (the run says
  which); `rescore` then scores earlier runs with the new keys.
- A section is an entry in `SECTIONS` (`bench.ts`): its trigger, flags,
  persona copy and judge. The weekly routines review would be manual with
  both flags on and routines due, a persona copy with last week's routine
  suggestions seeded, the feed session ended as it starts (its cost and time
  left out), and an answer key of what to keep, retire and add.
