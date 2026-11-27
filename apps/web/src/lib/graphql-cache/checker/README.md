# Cache handover checker

Runs the real browser cache, over a simulated browser, through every schedule
of a fault, and checks that no page loses its cache and no queued write is lost.

Real: `createWorkerCacheHost`, `createRetirableCacheHost`,
`CacheCoordinatorPageAdapter`, `CoordinatorRouter` (with `CoordinatorCore` and
`CoordinatorHandoff`), the coordinator and engine worker runtimes, and
`createCacheRecovery`. Stand-ins: the browser (`sim.ts`), the WASM engine and
OPFS (`fake-engine.ts`), and how `graphql-soup.ts` builds, drops and restarts
its host (`Page` in `world.ts`; keep the two the same).

| File | Holds |
| --- | --- |
| `sim.ts` | Contexts, message delivery, Web Locks, BroadcastChannel, timers and the clock. Nothing happens unless the checker says so. |
| `world.ts` | Pages, coordinators and engine workers on the sim; the faults. |
| `properties.ts` | What must hold, S1–S8 over the run and L1–L3 after it. |
| `explore.ts` | Runs one schedule, every schedule within a bound, or a script. |
| `scenarios.ts` | The scenarios with their bounds, and the scripts. |
| `known-violations.ts` | What is known to break, and why: a head sent from a tab that stays frozen past the handover wait. |
| `handover.checker.test.ts` | Explores, and compares with the known violations. |
| `handover-plants.checker.test.ts` | Breaks the real code on purpose; the checker must notice. |

## What a run does

Open the pages and give each a draft and a read at once. Deliver messages and
fire timers for 60 virtual seconds, injecting faults. Then faults stop: every
page that is not frozen comes online and is shown, six minutes pass (longer than
any timeout in the cache; a stretch of nothing but answered heartbeats is
skipped, so a fault in one of those heartbeats goes unseen), and each page makes
one more draft and read. The properties are checked last.

A script can also have a page send the head of the queue (`{ send: page }`):
claim it, wait `SERVER_MS` (or the step's `serverMs`) for the server, and
commit, roll back or defer it (`settle`) through the host it claimed it from,
as the queue runner does. The fake engine keeps the claim's lease, writes a
settlement only under it, and records each lease it wrote for; S7 compares
that with what the host answered, and S8 catches a head still queued, or sent
again, after an answer that was not a deferral. The fake engine's enqueue
claims nothing and its leases do not expire, so a head an enqueue claims
during the wait is covered by the coordinator's unit tests only. The explored
scenarios send nothing.

## What a bound covers

`maxFaults` faults, each at any step, startup included, and `maxDelays` delays: a
message delivered before an older one on another channel or, in a scenario with
`late`, the oldest one held back until one of the armed timers is due, whether
that timer fires or is cleared first. Answers
to lock requests are messages too. Otherwise the oldest message goes first, and
timers fire only when no message is waiting.

A schedule is skipped when it reaches a state (`World.signature`) already
explored with as much budget and time left: every context has handled the same
events in the same order, with the same messages, locks and databases, and as
long to go on every armed timer. The heartbeats a context handled are left out,
which is the one approximation; the deep run repeats the scenarios with a single fault or delay with `prune: false`, and both
must find the same.
Reaching `maxRuns` or a step cap fails the test.

## Run it

From `apps/web`:

```sh
bunx vitest run src/lib/graphql-cache/checker
HANDOVER_CHECKER_DEEP=1 bunx vitest run src/lib/graphql-cache/checker   # hours
HANDOVER_CHECKER_REPORT=/tmp/report.json bunx vitest run src/lib/graphql-cache/checker
```

The report has every violation with a shortest schedule that shows it and the
choices `runSchedule` replays it from.

## When it fails

- **A violation that is not known.** The change broke the handover, or let a
  schedule through that nobody had looked at. Fix it; don't list it.
- **A known violation it no longer finds.** The change fixed it: delete its
  entry.

A violation is known when an entry has the same symptom and no more faults. A
fault is named with whether it hit a page with an engine (`owner`) and counted
as often as it happened, but a listed symptom still hides the same symptom under
more faults until it is fixed. The report leaves those out too.
A test that stays red on an unrelated edit means `Page` or the fake engine no
longer matches the code it stands for.

## What it does not cover

The account and generation fences around a session, Safari's and Firefox's own
timing, the WASM engine and real OPFS, the native host, the queue runner itself
(scripts stand in for it), requests the handover does not depend on, and more tabs, faults or delays than the bound. An end of a
whole browser process takes the page and its build's coordinator
(`crash-process`), not other pages of that process. A coordinator's name that
answers nobody (`lose-coordinator`) does so until every page of its build closes,
and a name nobody used before always answers. A frozen page that keeps the owner
lock is let off: L1 and L2 excuse the other pages until it thaws or ends, since
nothing may take its files from it. Two scripts prove that they recover then. A
database is read whole or not at all when its queue is copied out of it,
and the copy always can be; the engine's own tests cover the rest
(`crates/client/cache-wasm/src/shell/test/queue_salvage.rs`). A freed lock has
its next holder at once, and only the news of it can be late; one message at a
time is held back.
