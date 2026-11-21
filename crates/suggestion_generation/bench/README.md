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
| `sides.ts` | One side of a comparison joined from run files, and the checks two sides must pass to be set side by side. |
| `report.ts` | The summary table. |
| `heldout.ts` | Writing held-out personas, the ledger of their use and the answer keys each person was first scored against. |

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
routine can't start when mail arrives (and the routines brief asks only for
scheduled ones); every other flag is off.

| Section | Generation | Persona copy | Answer key |
| --- | --- | --- | --- |
| `routines` | onboarding (`POST /suggestions/generate`), `enable-routine-suggestions` only: the routines session of the onboarding layout (one for every surface), 240 s cap, one retry when it suggests nothing | `signup`: the person a minute after signing up, their mailbox and nothing else | 5 or 6 needs a routine would meet (which catalog keys meet each, or what a drafted routine must do), 4 or 5 decoys, and every other catalog routine placed as `fine` or `misfit` |
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
routines once, as meeting needs, as a decoy, `fine` or `misfit` (nothing
in the person's mail or workspace for it to work on: an agents digest for
someone with no agents; a part of the app they haven't used yet is no misfit
by itself); a pick is
in the wrong sidebar when its first one isn't among the routine's surfaces,
and a duplicate when an earlier pick has its key. Only what the session
wrote for it is the judge's: a reason that invents a fact, and the knobs it
set (bad or breaking it). A drafted routine and a card are the judge's call
throughout. Judged twice, the baseline's generations of 2026-11-18 differed in
routines' *bad* by 0.82 a generation (root mean square), mostly misfit and
sidebar calls on catalog picks; scored by key, by 0.41. Feed cards, all
the judge's, differed by 0.33 to 0.47 in *bad* and 0.33 in *found*.

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
"now" and time zone. Every seat copies the first under a domain of its own, so
where renaming a seat's domain to the first seat's loses nothing (none of its
mail or suggestions names the first seat's domain in any case or its own in
another case, and its mail renamed is the first seat's word for word: a
snippet cut at 500 characters can cut a longer domain's copy elsewhere), a
routines judgement reads the first seat's mail and the seat's suggestions
renamed (`routinesEvidence`), so a persona's seats, in every rep of the run
(all at one "now"), share the person, mail, catalog and key word for word;
those go after the rubric, which the route caches, and the persona's first
judgement writes the cache the others then read. Any other seat is judged on
its own mail, which no other seat's judgement shares. Rejudged that way, the
same generations scored within the judge's own pass-to-pass difference (main
12.3 against 12.3 and 11.0, a single-session build 64.7 against 66.3) at about
half the judge's cost.

A run records its judge (`JUDGE` in `judge.ts`: the model and a version to
bump with any change to a rubric, a schema or what a judgement reads), and
`compare` and `noise` refuse two sides judged by different judges (`rejudge`
each run of the older side) or a side whose judge wasn't recorded, and no side
joins runs without one. A run also records a digest of each persona's
workspace and mail as its generations read them: `compare` and `noise` refuse
two sides that read a persona they share differently or without a digest, no
side joins runs that do, and `rejudge` refuses a run whose persona has changed
since, or one from before the digest was kept, so the judge reads what the
generation read: run that one again instead. A run records a digest of each
persona's answer keys too, and `compare` and `noise` refuse two sides scored
against different keys, or one without the digest: `rescore` the older one,
which scores it against the keys as they are and records them. `noise`
measures one build against itself, so it also refuses two runs of different
or unrecorded commits, or with different flags, and a side is one build: its
runs share a commit and flags.

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
bun $B/bench.ts compare <main run.json> <mine run.json> --margins <score,found,bad>
bun $B/bench.ts report <run.json>...
bun $B/bench.ts rescore <run.json>...               # after changing an answer key: free, no model calls
```

A section's default size is 3 personas × 3 seats × 3 reps: 27 attempts. A
seat is a copy of a persona under a domain of its own (`founder`,
`founder/s2`, `founder/s3`), a person of its own, so copies generate side
by side (see **Seats** below). Seats sign up on their first run (one signup
each for `routines`, five for `feed`'s teams), against the webhook's 50
an hour: on a new stack, run the two sections an hour apart, or `all` stops
part way through the feed when the webhook refuses a seat. Judging runs as
three grader accounts: the feed's while the next rep seeds, the routines'
once the last rep has generated (see **Seats** below).

Each run writes `~/.cache/suggestions-bench/runs/<label>-<section>-<set>-<time>/run.json`,
with each attempt's suggestions, the judge's marks, the score and the
sessions' transcripts beside it. A routines attempt is written as soon as it
has generated, marked not judged until it is, so `rejudge` can judge a run
that stopped first; `rejudge` reads each work list again from the
transcripts (where they were saved, or beside `run.json`). A list it
finds replaces the run's reading, and a list it can't read is an error;
finding no list, the run's reading stands (its list, its error, or none
read). Where both transcripts are gone, or the one found holds no prompt,
the run's reading stands too, and a run with neither a list nor an error
has an unknown list. The harness sends a brief to its
runtime as Markdown, which backslash-escapes characters such as `_` outside
code; the bench reads a list in a fenced `json` block as written and undoes
those escapes in a bare one (briefs before the fence). A brief that says it carries a list (the
drafting brief's words at the start of a line, outside the mail's
`<untrusted>` block) the bench still can't parse is that attempt's list
error, as is an unknown list: counted as not judged, by `rescore` too, never
an empty list. `run` starts the stand-in if it isn't up and holds the
stack while it runs (the drafting eval's lock), so two runs never share it.

To compare a change: run main, switch the stack to your build (`just
run_local --instance sugbench ...` from your branch, or reload the harness),
run the same section with another `--label`, then `compare` with the
margins two runs of main measured. A difference inside them is noise.

### Noise

`compare` takes, for each persona both runs have, B's mean less A's, and
averages over personas; its 95% interval is that ± t standard errors, from
how much each persona's attempts spread on each side. It calls a change a
win or a loss only when the score moved past its margin (`--margins
score,found,bad`: how far two runs of main land apart at the default size,
on the same kind of set and judged by the same judge) and the interval
leaves zero. *found* and *bad* get the same
test against margins of their own, and show a change in one before the
score can. On a month set judged for stream jobs, good drafts and good
drafts by stream job get it too, with two margins more (`--margins
score,found,bad,goodDrafts,jobDrafts`, as `noise` prints them); given three,
`compare` reports their change as unmeasured. Measure the margins again after changing the personas, the
judge or the default size:

```sh
bun $B/bench.ts run routines --label main-a && bun $B/bench.ts run routines --label main-b
bun $B/bench.ts noise <main-a run.json> <main-b run.json>
```

`compare` has no margins of its own and refuses to run without
`--margins`: ones measured on another kind of set or by another judge
would decide nothing. The week-set margins below were measured with the
judge from before judges were recorded.

A side of `compare`, `noise` or `report` may be several runs of one build,
section and set, judged by one recorded judge on personas read the same way and
scored against the same keys, joined by commas (`a1.json,a2.json`), read as one. The margins hold at the default size:
a smaller run (fewer seats or reps) is only a look.

### Held-out personas

Tune on `personas/`. To confirm a change on people nobody tuned against,
write a fresh set and run both sides on it once:

```sh
bun $B/bench.ts heldout make h1 3       # 3 new personas, written by the model, in ~/.cache/suggestions-bench/heldout/h1
bun $B/bench.ts run routines --set h1 --label main
bun $B/bench.ts run routines --set h1 --label mine
bun $B/bench.ts heldout list            # how often each set was read
```

Writing a person takes about 17 minutes and $3 (Opus 5.5, about 22
short model calls each, since the stack gives one 90 seconds), and three
are written at once, so a set of three or of nine takes under an hour. If one still times out, `heldout make`
says which people are missing; run the same command again to write just
those. The author is told every slug, full name and mail domain the tune
set and the held-out sets already have. A set whose author still sketches
one of them, or two people of the set who share one, stops before anyone
is written, saying which of the three repeated but not whom; run it again.

Held-out sets live outside the repository and are reported only in
aggregate: `report`, `summary`, `compare` and `noise` show a measure only
over two held-out people or more who have it (scored in every run set side by
side; timed, rated, or with a work list read, for those measures), and say
why where they show none. A set written before keys placed every catalog routine (`h2`
and earlier) can't be read by the `routines` section: write a new one. Don't open their files while tuning. Each run is recorded in the
set's ledger; after a baseline and one candidate a set is spent and the bench
says so: make a new one. The first run, rejudge or rescore of a held-out
person writes down the answer keys it scored them against (`keys.json` in the
set), and every later one must score against the same keys, so no key changes
after a build has run on its person; one that changed stops the bench, saying
how many people's keys changed but not whose. Nothing the bench prints names a
held-out person: their slugs, names and domains are left out of its errors and
progress lines.

### A month of mail

`heldout make <name> <count> month` writes people with a month of mail
instead: 30 days, up to 500 messages, enough recurring work that five good
drafted routines are within reach, and a streams key (`streams-truth.json`)
that spells out every stream in the mail: its senders, count, cadence, what
each message asks and what the person does with it, as `work` (mail they act
on), `noise` (mail they read or ignore) or `thread` (a one-off
conversation). Every message of `inbox.messages` is the inbox's. A person
written since sent mail was added (sets `msent0`, `mdev2` and later) is also
written with what they sent in the same 30 days
(`inbox.sent`, never seeded): a reply to or forward of the plan's count of
each stream they answer or forward, sent 20 minutes to 9 hours after its
message, and the mail they start themselves, with text on the newest 50; each
stream of the key says in one word what they do with its mail (`does`:
answers, forwards, files, leaves to someone, nothing, or sends), to whom
(`to`), and how many they sent. The writer refuses a person
whose month keeps fewer than 250 messages or whose key has fewer than eight
needs (by id, with a drafted routine that isn't blank) a drafted routine can
meet (five for earlier sets), after writing its needs from the same mail three
times. Both writers refuse a workspace where two people share a first name in
any case (each is mailed as first name at the domain) or a colleague is named
Owner (the person's own place), when sketching and when finishing a set.
`run`, `find` and `heldout make` take counts from 1 to 1000.
Writing one took $4.50 to $4.91 a person (three at once in about ten
minutes), and $5.70 with sent mail. The stand-in serves the month to the read
the finding step makes (`?days=30&limit=500&texts=100&snippet_chars=500`),
what they sent to its sent read (`&folder=sent` with `limit=200&texts=50`),
refuses any other window or folder, and serves the newest 100 to the old
read; the inbox reads hold the inbox alone, as Gmail and Outlook are read,
all cut at the exact start of the window and with texts cut by characters,
as the service cuts them. The routines judge (`v5`) reads what a person
sent beside their mail, where they have it, so a reason that rests on it
isn't marked invented.

On a month set a routines run also reports good suggestions: a drafted
routine or a catalog pick that meets a need of the key with nothing wrong
with it, counted apart, and how many generations reached five good drafts.
Beside them it reports a second measure, judged apart (`judgeJobs`): for
each suggestion, the key's work streams whose real job it does right (runs
on that stream's mail and does what the person does with it, or the part an
assistant can do without sending as them), whether or not a need of the key
bundles that stream with others. A good draft by stream job does at least
one work stream's job with nothing wrong by the first measure's flags; the
run reports them per generation, how many generations reached five, the
distinct work streams their jobs cover, and good catalog picks by stream
job. Both measures are always reported. Good catalog picks have no measured
margin.

`find` measures the finding step on its own: one model call reads a month
person's mail as the service reads it (`mailText`, the lines
`suggestions/work.rs` writes) with `find.md`, the list is bounded as the
service bounds it before a session reads it (`boundedList`), and the judge
matches each listed stream to the streams key, with the addresses of every
seat and copy read as the key writes them (`asWritten`). A judge whose marks
leave an entry unmarked, mark one twice or name a stream the key doesn't have
is asked again, twice at most. A list scores the key's work streams it names,
as the stream an entry mostly covers or one it covers in full (*found*), and
the entries that name none (*unreal*: noise, a one-off thread, or nothing in
the mail). It runs on a set whose every person has a streams key, times each
list from just before its call, and prints per-person results only for
people who aren't held out; for held-out people it prints only whether each
call answered, and their aggregate only over two people or more:

```sh
bun $B/bench.ts find --set m1 --label flash --model google/gemini-3.8-flash --thinking low --reps 2
```

A candidate behind a flag runs with it on: `--flags
routine-suggestions-find-work` (comma-separated) adds flags to the
section's. With `routine-suggestions-find-work` on, the run scores the work
list each generation's drafting session read the same way (`workListOf`
reads it from the earliest `session/prompt` the harness sent a runtime that
holds one), a generation whose session read none as finding nothing, its
build failed or not, and a list the judge couldn't mark apart from the
routines, which are scored all the same. `rescore` scores the lists again
from their marks, and refuses marks that no longer fit the list and the key. The run reports
time to the last suggestion beside the first.

The seed CLI refuses an address whose local part isn't ASCII, so as a
persona is loaded, each such address in its mail, workspace and answer keys
alike is spelled in ASCII (accents dropped, any other non-ASCII character
removed), or tagged where that would match another of the persona's
addresses in any case or leave the local part empty (`asciiSpellings` in
`personas.ts`). `bun test $B` checks those spellings.

## Baseline

Main (`5419b2521f`, the 45-routine catalog) with the bench on top, two runs
of each section at the default size, on one local stack, 2026-11-18. Each
row is 27 attempts; the score's range is its 95% interval, times are
medians.

| Section | Run | Score | Found / needs | Bad | Invented | Suggested | First | End |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `routines` | A | 13.0 (0.6 to 25.1) | 3.11 / 5.7 | 2.44 | 0.33 | 20.7 | 64 s | 166 s |
| `routines` | B | 12.5 (0.9 to 24.1) | 3.11 / 5.7 | 2.48 | 0.19 | 20.9 | 60 s | 199 s |
| `feed` | A | 76.1 (68.7 to 82.3) | 7.07 / 9.0 | 0.22 | 0.19 | 11.4 | 198 s | 336 s |
| `feed` | B | 72.8 (69.1 to 76.1) | 6.93 / 9.0 | 0.37 | 0.22 | 11.6 | 180 s | 328 s |

Noise (`MARGINS`), main against main:

| Section | Part | Moved | 95% interval | Standard error | Margin |
| --- | --- | --- | --- | --- | --- |
| `routines` | score | -0.5 | -11.5 to 10.5 | 5.4 | 11.5 |
| `routines` | found | +0.00 | -0.47 to 0.47 | 0.23 | 0.47 |
| `routines` | bad | +0.04 | -0.45 to 0.53 | 0.24 | 0.53 |
| `feed` | score | -3.3 | -11.0 to 4.4 | 3.8 | 11.0 |
| `feed` | found | -0.15 | -0.84 to 0.54 | 0.34 | 0.84 |
| `feed` | bad | +0.15 | -0.12 to 0.42 | 0.13 | 0.42 |

A change as large as a part's margin comes back as a win about half the
time, one larger by 0.84 standard errors 80% of the time; main against
main passes a margin by chance about 2% of the time. So:

| Section | Change per attempt | Part | Called a win |
| --- | --- | --- | --- |
| `routines` | one more need met | found | 99% |
| `routines` | one fewer bad suggestion | bad | 97% |
| `routines` | either, on the score (17.6 points) | score | 87% |
| `feed` | one more planted item found | found | 68% |
| `feed` | one more bad card (the feed makes 0.3 a generation) | bad | 100% |
| `feed` | either, on the score (11.1 points) | score | 51% |

The feed is the weaker of the two: a generation finds 5 to 9 of its 9
planted items, so *found* spreads (standard error 0.34) and one more item
found per attempt is caught about two times in three. Four reps a side
instead of three would take it to about 80% (an estimate from the standard
error, not measured), for a third more cost and time.

The earlier bench (3 personas × 3 reps, catalog picks judged) had margins of
37 (routines) and 17 (feed): seats tripled the attempts, and scoring
catalog picks by key halved the judge's share of routines' noise.

### 13 → 45 catalog routines

The same scoring on the earlier baseline's 18 generations of main
`c59b249582`, whose catalog had 13 routines, against the 54 above:

| Part | 13 routines | 45 routines | Change (95%) | Verdict |
| --- | --- | --- | --- | --- |
| score | -4.6 | 12.7 | +17.3 (5.1 to 29.6) | better |
| found | 2.78 | 3.11 | +0.33 (0.02 to 0.65) | noise |
| bad | 3.06 | 2.46 | -0.59 (-1.29 to 0.11) | noise |

The score is better past its margin; *found* rose and *bad* fell, each short
of its own test. Per generation the sessions now make 20.8 suggestions (from
13.2), from 36 or 37 of the 45 routines a run: 3.2 catalog picks that meet
a need (from 2.3), 1.2 decoys (1.2), 0.6 misfits (0.6), 14.9 fine picks the
key didn't ask for (5.9), and 0.9 drafted routines (from 3.2). The founder and the
plumber gained a need each from new catalog routines (promises, meeting
briefs, customer requests); the sales rep lost one of the two needs only a
drafted routine meets (found 3.83 to 2.94). Wrong sidebars fell from 0.56 to
0.19 a generation.

### One onboarding session, judged once a run

Main `fa31ccc0c0` (one routines session for every surface) twice on
`routines`, every rep at one "now" and each persona's judge prefix written
once a run (`judgeLast`), 2026-11-19, on one stack:

| Run | Score | Found / needs | Bad | Suggested | First | End |
| --- | --- | --- | --- | --- | --- | --- |
| A | 70.5 (61.6 to 79.5) | 4.07 / 5.7 | 0.11 | 4.8 | 136 s | 151 s |
| B | 70.4 (61.5 to 79.3) | 4.11 / 5.7 | 0.15 | 4.9 | 141 s | 155 s |

`noise` A against B: score −0.1 (95% −7.5 to 7.2), found +0.04 (−0.28 to
0.35), bad +0.04 (−0.17 to 0.24), each inside its margin: judging once a
run leaves `MARGINS` as they were.

### Main on a month of mail

Main `1d77cd00fd` on a readable month set (3 people, 10 needs each on
average, of which 5 to 8 only a drafted routine meets), 27 attempts,
2026-11-20:

| Score | Found / needs | Bad | Suggested | Drafted | Good drafts | Five good | Good picks | First | End | $ / gen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 19.3 (12.2 to 26.8) | 2.67 / 10.0 | 0.67 | 5.3 | 2.26 | 0.56 | 0 of 27 | 1.67 | 76 s | 173 s | $0.072 |

The finding step alone on the same people, 2026-11-20 (time includes the
bench's retries):

| Model | Lists | Found | Unreal a list | Median time | $ a list |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-3.8-flash`, thinking low | 3 of 3 | 95% (39 of 41) | 0.3 | 33 s | $0.016 |
| `anthropic/claude-sonnet-5-5` | 4 of 6 | 96% (52 of 54) | 0.25 | 175 s | $0.12 |
| `anthropic/claude-haiku-4-5` | 3 of 3 | 80% (33 of 41) | 3.7 | 87 s | $0.086 |

Sonnet's two missing lists, and every list of Gemini 3.8 Flash at its
default thinking (6 of 6), ran past the stack's 90-second limit.

## Cost and time

An attempt's cost, from the baseline runs (`feed`, 2026-11-18) and main's
runs above (`routines`, 2026-11-19). A generation's cost is its
`ai_usage`; the judge is Opus 5.5.

| Section | Generation | Judge | One run (27 attempts) | Wall time of a run |
| --- | --- | --- | --- | --- |
| `routines` | $0.08 | $0.05 | about $3.70 | 33 to 35 minutes |
| `feed` | $0.18 | $0.28 | about $12 | 26 to 32 minutes |

A `routines` run's judge costs $1.35 to $1.65. Of one at $1.64, $0.75 wrote each
persona's prefix and each attempt's own part, $0.70 was output and $0.20
cached reads.

A comparison is one run of the change against a stored run of main from the
same stack: the cost of one run. Run main again when main changes what the
section runs, or after a day (the model drifts). The stand-in and the stack
cost nothing beyond the model calls.

## How it works

- **Dates.** Each persona was written for one evening, 2026-11-08 20:00 UTC.
  The bench seeds its mail as old as it was then and moves every date in the
  text, weekdays too, by the whole days since (`clock.ts`), so a run on any
  day sees the same week. Month names and quarters stay as written.
  Documents and tasks are seeded under keys that carry that number of days
  (`contentKey`): sync-service keeps an id's first text for good, so a
  re-apply on another day would leave the old dates in them while the judge
  reads the new ones.
- **The stand-in.** One Caddy container (`stub.ts`) on the stack's network,
  under the name `stack.env` points at: PostHog's `/flags` answers with the
  section's flags, and email_service's `/internal/recent_messages/{user}`
  answers with the persona's mailbox (the routines brief reads it from Gmail
  or Outlook, which seeded mail never reaches): the newest 100, the month
  for exactly the month read, or what they sent for exactly the sent read.
  A person with a month answers any other window or folder with a 400; everything else goes to email_service. The suggestions service trusts a flag for a minute, so the
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
- **Seats.** A rep seeds every seat of every persona (three at a time), then
  runs their generations: routines three at once, the feed nine
  (`--concurrency`). At nine onboarding generations at once, three
  sessions each, the harness on a busy machine took more than its 30 s to
  accept sessions' first prompts; the bench marks a generation with such a
  session (`delivery_unknown`) a bench error, so a build that breaks prompt
  delivery has nothing scored and `compare` refuses it rather than calling it
  a loss. The feed section indexes the
  seeded items for search first. Judging takes three grader accounts at a
  time, each judgement's cost read from its grader's usage. The feed's
  runs alongside, while the next rep seeds. Every rep of a routines run
  reads its mail at the run's one "now", so a persona's judgements share
  one cached prefix (the rubric, mail, catalog and key) across seats and
  reps; they wait for the last rep, so the cache is still warm, and each
  persona's first judgement pays to write it once, not once a rep
  (`judgeLast`).

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
