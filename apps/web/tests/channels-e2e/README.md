# Channels end-to-end suite

Playwright tests of everything channels do for a person, on the built web app
in Chromium against a whole local stack: its proxy, sign-in, services,
gateway and database. Nothing is mocked; attachment tests only forward the upload host a container
is given to the one the browser can reach. Four seeded people take part in a test, each
in a browser profile of their own, so what one does is checked on another's
screen. Every parallel worker has four people of its own: an open page hears
of everything its person is part of, so tests that shared people would slow
and disturb each other.

The tests assert only what a person sees and does: which messages are on
screen, in what order, how many, under whose name, which controls exist.
None looks at a request, a cache or the app's state, so the same tests hold
for any implementation of how messages are fetched, stored and synced, and
the suite can be run unchanged against a rewrite of those.

## Run it

Against a stack instance started with `just stack up --instance <name>` (give
it `RUST_MIN_STACK=16777216` in an `--env-file`: every page makes a Soup request,
which exhausts a debug service's default worker stack):

```sh
just seed-scenario --instance <name> apply --file seed/scenarios/channels-e2e.json
cd apps/web && just test-channels-e2e <name>            # everything
cd apps/web && just test-channels-e2e <name> -g MSG-03  # one test
```

Against the app of another branch, with this checkout's tests and the
instance's own services (update the instance from that branch first when its
services differ):

```sh
cd apps/web
just test-channels-e2e-with <name> <git ref or checkout directory>               # the suite
just test-channels-e2e-with <name> <git ref or checkout directory> -g MSG-03     # one test
FUZZ_SEEDS=1-60 just test-channels-e2e-with <name> <git ref or checkout> fuzz    # the fuzzer
```

It builds that branch's web bundle (kept by commit under
`~/.cache/channels-e2e/bundles`, or `CHANNELS_E2E_BUNDLES`), puts it in place of
the bundle the instance serves, and runs. Every `VITE_*` variable set goes to
the build and to the run, so `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true` in front
builds and tests the app that keeps channels on the device. A git ref is
built in a worktree of its own, from nothing; a checkout directory is built
where it is, which is faster when it has been built before. Only the commit
and the `VITE_*` variables name a kept bundle: after changing anything else
the build reads, set `CHANNELS_E2E_REBUILD=1`.

Against any address that serves the app with the scenario's people seeded:

```sh
CHANNELS_E2E_STACK_URL=https://localhost:22609 \
  bunx playwright test --config tests/channels-e2e/playwright.config.ts
```

| Variable | Meaning |
| --- | --- |
| `CHANNELS_E2E_STACK_URL` | The stack's origin. Required. |
| `CHANNELS_E2E_RUN_DIR` | Where the run keeps its sign-ins, the long history it made, its report and traces. Default `.run` here. Give two runs at once a directory each. |
| `CHANNELS_E2E_PEOPLE` | Email addresses, comma separated, four for each worker (owner, two teammates, an outsider), for a stack seeded with others. They must carry the display names the scenario gives (Ada Owner, Ben Member, Cy Teammate, Dee Outsider), which the tests look for on screen. |
| `CHANNELS_E2E_WORKERS` | Parallel workers, default 4. The seed scenario has people for six. |
| `CHANNELS_E2E_KEEP_NOTIFICATIONS` | Set, global setup leaves the people's notifications as earlier runs left them; by default it removes them, so a run does not carry the load of the runs before it. |
| `CHANNELS_E2E_FIRST_CAST` | The first worker's people, counted from 0 (default). A second run at the same time on the same stack needs people of its own: give it the number of workers the first run has. |
| `CHANNELS_E2E_VIDEO` | Set to record a video of every test. |
| `VITE_ENABLE_CHANNEL_LOCAL_SYNC` | Set to `true` when the app under test was built to keep channels on the device (the client that does is not on `main` yet, and CI runs the app without it): a known defect can be marked for one build alone. The tests of a device that keeps channels are not here: they follow that client. |

The people sign in through the passwordless code flow of a local stack, so
the suite needs a stack that offers it; it does not run against a deployed
environment.

## How it is put together

- `harness/people.ts` signs each worker's four people in once per run and
  keeps their sessions. Ada owns the team and is the default `page`; Ben and Cy are her
  teammates; Dee is outside the team.
- `harness/api.ts` is what a person can do through the services. Tests use
  it to set a scene and to play the other person; the action a test is about
  goes through the page.
- `harness/channel.ts` is the page object for an open channel.
- `harness/network.ts` puts a device in the conditions a connection can be
  in: offline, one window cut off, a very slow link, message writes that
  never reach the services, and writes whose answers are lost.
- `harness/device.ts` reads a channel off the screen as lines of text
  (`shown`), and has the steps that leave a channel on a device and open it
  again with no connection. `harness/server.ts` reads the same lines from the
  services (`serverChannel`). The tests of a channel brought up to date (`current`),
  and those of a device that keeps channels, which follow that client and
  are not here, end on three things that must
  agree: the lines the test expects, the screen, and the services.
- `harness/history.ts` makes one long channel (230 messages, a 30-reply
  thread far back) before the first test and keeps it for later runs against
  the same stack. Tests only read it.
- Every other test makes the channels it needs, with unique names, so tests
  run in parallel in any order.
- `fuzz/` is a differential fuzzer over the same harness: random sequences
  of operations by several people, run against the builds with and without
  `VITE_ENABLE_CHANNEL_LOCAL_SYNC` and compared ([fuzz/README.md](fuzz/README.md)).
  It is run by hand, not by `just test-channels-e2e` or CI.

## In CI

`Channels end-to-end` (`channels_e2e.yml`) is not part of `PR CI`, and
`CI gate` does not wait for it.

| When | What runs |
| --- | --- |
| A push to `main` that changes the web app, backend code, or what the stack is seeded and started from | The suite and the ledger check, one run at a time; of the pushes that come meanwhile only the newest waits. |
| Nightly, 04:00 UTC | The same, on `main`. |
| By hand: `gh workflow run channels_e2e.yml --ref <branch>` | The same, on that branch. Do this before merging a change to channels or to the suite. |

A red run on `main` blocks nothing. Its last job tells the Macro Alerts
channel when the pushes or the nightly runs turn red, with the failed tests,
and when they pass again
([what to do](../../../../docs/development/ci.md#when-an-email-end-to-end-alert-fires)).
When a run fails with many tests waiting for a channel to show
(`harness/channel.ts`, `shown`), look for the line the step prints after the
ledger: "Postgres refused N statements in an aborted transaction". It is a
clue, not a verdict: a backend defect, not one of channels, hands a pooled
connection back inside a transaction, and every later request that gets it
fails, so pages show "Conversation unavailable". Check a failed test's
screenshot for that heading before reading the failure as one of channels.
The run stays red either way.

A failed run keeps the stack's logs (`channels-e2e-stack-logs`) and its
traces (`channels-e2e-results`). One that runs out of time keeps the logs too: the
suite's step stops after 30 minutes, short of the job's 45, so the steps
after it still run. It has traces and a report only if the tests had
finished; while the stack starts, the step's log says once a minute what is
running.

The stack starts with local agent sandboxes off
(`DEV_DANGEROUS_LOCAL_CONTAINERS=false`): no test starts a sandbox, and
building its image is uncached and can outlast the job. A test that needs a
sandbox has to turn them back on and pay for the image.

## The ledger

`ledger/inventory.tsv` lists what channels do, and for each thing the tests
that cover it or the reason none does. `ledger/known-defects.tsv`
lists the tests that assert behaviour the product does not have yet, and
whether that is in builds without `VITE_ENABLE_CHANNEL_LOCAL_SYNC` (`off`), with it
(`on`) or `both`; they are marked `knownDefect(...)` and fail the run the day
the defect is fixed, so the mark gets removed. `ledger/intermittent-defects.tsv`
lists the tests with a check a defect fails only in some runs, wrapped in
`failsSometimes`; the checker reports each run in which one showed. When the
check is that an open page shows what someone else just did, and it has been seen to fail, use `arrivesLive`: it records the miss the same way,
then reloads the page and requires the check, so a change that is lost still
fails the run. It takes the locator of what should arrive and excuses only
its absence; what the message says stays an ordinary check. `missedLive` is
the same without the reload, for a test that has to do something of its own
after a miss.

```sh
bun tests/channels-e2e/ledger/check.ts                      # ledger against the tests
bun tests/channels-e2e/ledger/check.ts --report <report>    # and against a run
```

## Writing a test

- Title: an id (`MSG-03`) then a sentence a person would say. Above it, a
  comment that starts `If this fails,` and says what a person would suffer.
- Assert what is on screen with literals. No sleeps, no waiting on requests.
  The one timed wait is `leaveAlone` in `harness/device.ts`: a device
  fetches channels ahead only while its person does nothing, so doing
  nothing for a while is the step under test (REC-04). The one read
  of what a page has fetched is `codeFetched`, with which `goOffline` lets a
  page finish fetching the app's code before it cuts it off: no test asserts
  on it.
- A test of what only a build with `VITE_ENABLE_CHANNEL_LOCAL_SYNC` does (channels
  kept on the device, writes that wait there) does not belong here until
  `main` has that client: the check of a run against the ledger counts a
  skipped test as a failure, so a test cannot skip itself on other builds.
- A test that runs on both builds and reads messages can fail on one alone:
  with the flag, messages come through the device's own path, and a break
  of the other path leaves the test passing, so watch it fail on each.
- Add the id to `ledger/inventory.tsv`. Before trusting a new test, watch it
  fail: break the product where the behaviour lives and run it.
- A test that fails because the product is wrong keeps asserting the right
  behaviour, marked `knownDefect('both')` (or `'off'` / `'on'` when only one
  build has the defect) with the defect in a comment and a row in
  `ledger/known-defects.tsv`.
