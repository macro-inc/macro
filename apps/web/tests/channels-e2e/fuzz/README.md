# Differential fuzzer for channels

Runs the same random sequences of channel operations against two builds of
the web app, one that reads and writes channel messages over REST (built
with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=false`) and one that keeps them on the
device (`=true`), and compares what each ends with: what the services hold
and what every window shows.

The fixed suite beside it checks behaviours someone thought of. This looks
for the ones nobody did: several people and windows at once, in orders no
one wrote by hand.

## What a sequence is

A seed gives a list of operations (`gen.ts`), the same on every build and
machine. Four windows take part: two of one person in one browser profile
(`a1`, `a2`), one each of two more people (`b1`, `c1`). A fourth person
writes through the services only. Three seeds in four start from a channel
of 6 messages and one long thread; every fourth from one of 140, which also
gets scrolled back through and opened at links to old messages.

| Operation | What it does |
| --- | --- |
| send, reply, edit, delete, react | In a window, as a person does it; or through the services |
| at once | Two to four of those, by different people, started together |
| reload, visit | Loads the page again; opens the other channel and comes back |
| scroll back, link, newest | Long channels: pages back, opens at an old message, returns |
| cut off, restore | A person's device goes offline, loses its message writes, or loses only their answers; then gets the connection back |
| read, settle | Reads one window, or every window, top to bottom with every thread open |

An operation picks its message when it runs (`pick` modulo the messages it
could act on), so a sequence still means something after operations are
removed from it.

## What is compared

`model.ts` works out, without a browser, what each build should end with.
The two models differ only in what becomes of a write made on a device that
is cut off. With no connection both hold it and deliver it when the
connection is back (the build without the flag only while the page stays
open, and a sequence never loads a page again offline). With its requests
failing, the build that keeps channels on the device holds it and
delivers it when they stop failing; the other loses it. (With only the
answers lost, the first write a device makes is carried out and every later
one waits behind it; the other build carries them all out.) The runner
(`run.ts`) checks a build against its own model as it goes and records every
disagreement as a finding; it never stops a sequence for one:

- after writes, the services hold what the model says (order between
  operations, texts, replies, reactions);
- a connected window shows exactly what the services hold, in their order;
- a window of a device that is cut off shows what the person did there;
- a message a person sends is on their screen, sent or waiting (one drawn
  only after scrolling to the newest message is `own message not brought
  into view`);
- after scrolling back or opening a link, the rows drawn are one unbroken
  run of the channel;
- at the end, with everyone connected: every window, then every window
  loaded again, then the services against the model.

`compare.ts` then puts the two builds side by side. A sequence whose builds
ended differently, each as its model says, is an intended difference (the
writes made while requests failed). A finding one build has and the other does not
is a difference in behaviour; one both have is not a difference between
them. Findings are named by kind and shape (`window differs at the end: a
reply missing`).

## Run it

Against a stack seeded as for the suite (`../README.md`), serving one build
and then the other:

```sh
cd apps/web
export CHANNELS_E2E_STACK_URL=https://localhost:<port> CHANNELS_E2E_RUN_DIR=<directory>
config=tests/channels-e2e/fuzz/playwright.config.ts

# with the build made with VITE_ENABLE_CHANNEL_LOCAL_SYNC=false being served
VITE_ENABLE_CHANNEL_LOCAL_SYNC=false FUZZ_SEEDS=1-60 bunx playwright test --config $config
# with the build made with =true being served
VITE_ENABLE_CHANNEL_LOCAL_SYNC=true FUZZ_SEEDS=1-60 bunx playwright test --config $config

bun tests/channels-e2e/fuzz/compare.ts $CHANNELS_E2E_RUN_DIR
```

The variable tells the fuzzer which build it is looking at, as it tells the
suite. Each sequence writes `fuzz/<off|on>/<id>.json` under the run
directory: its operations, what each write became, every finding, and the
end state. A picture of the window is kept beside it when an operation
fails in one or a waiting message is not shown. `compare.ts` writes `fuzz/report.json`.

| Variable | Meaning |
| --- | --- |
| `FUZZ_SEEDS` | `1-60` or `3,17`; default `1-4` |
| `FUZZ_LENGTH` | Operations in a sequence; default 40 |
| `FUZZ_CASES` | A file of sequences to run instead (what `shrink.ts` writes) |
| `FUZZ_FAIL_ON` | Fail a sequence that has this finding (`any`, a kind, or kind and shape) |
| `FUZZ_TRACE` | Keep a Playwright trace of a sequence that fails |
| `CHANNELS_E2E_WORKERS` | Sequences at once, one cast of people each |

## Reproduce and shrink

A sequence is its seed and length: `FUZZ_SEEDS=17` runs it again. To get a
short one that still finds the same thing, against the build that found it:

```sh
bun tests/channels-e2e/fuzz/shrink.ts <run dir>/fuzz/on/seed-17.json \
  "window differs at the end: a reply missing" <work directory>
```

It removes operations a part at a time and keeps the shortest sequence that
still has the finding, running each round's candidates side by side
(`FUZZ_TRIES=3` for a finding that does not show every time), then writes
`shrunk.json` with the sequence and how often it showed in three more runs.
Run that file on either build, with a trace:

```sh
FUZZ_CASES=<work directory>/shrunk.json FUZZ_TRACE=1 \
  FUZZ_FAIL_ON="window differs at the end: a reply missing" bunx playwright test --config $config
```

## Reading a finding

- A finding is where a build disagreed with the model, not yet a defect:
  check it against the picture or the trace, and against what the fixed
  suite already knows (`../ledger/known-defects.tsv`).
- Once the services disagree with the model the runner stops waiting for
  them in that sequence, and later findings there may follow from the first.
- The models describe the builds as they behaved when this was written. A
  deliberate change to what a cut-off device does belongs in `POLICY` in
  `model.ts`.

## What it does not do

- It reads windows by scrolling them, so it takes a few minutes a sequence.
- A page cannot be loaded offline, so reloads and links are skipped for a
  person who is offline; so is visiting the other channel on the build that
  keeps nothing.
- Channel management, membership, direct messages, attachments, mentions
  and notifications are left to the fixed suite.
- Order is checked loosely. What the services hold is compared with the
  model as a set of threads; their order is checked once, at the end, between
  operations only, and not for deleted messages. A window is read by
  scrolling, keeping each row where it was first seen, so a row drawn twice
  or moved while being read is not noticed.
- A reaction is compared by emoji and count, not by who made it.
- Operations made at once are modelled in the order they are listed. Two that
  conflict (a delete and a reaction on one message) are not both tried, and
  only one outcome of the race is expected. A connection restored at the same
  moment as a write through the services is modelled as delivering what it
  held first: when the two conflict (a reply held, its parent deleted) the
  other order is reported as a disagreement.
- A write made on a cut-off device is not checked against the services until
  the next operation that waits for them.
- A deleted message whose last reply is then deleted stays in the model as
  deleted; whether the services still list it was not checked.
- `compare.ts` counts a finding as shared when both builds have one of the
  same kind and shape, whatever the step; the steps are in each result.
