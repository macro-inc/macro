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
| `CHANNELS_E2E_FIRST_CAST` | The first worker's people, counted from 0 (default). A second run at the same time on the same stack needs people of its own: give it the number of workers the first run has. |
| `CHANNELS_E2E_VIDEO` | Set to record a video of every test. |

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
- `harness/history.ts` makes one long channel (230 messages, a 30-reply
  thread far back) before the first test and keeps it for later runs against
  the same stack. Tests only read it.
- Every other test makes the channels it needs, with unique names, so tests
  run in parallel in any order.

## The ledger

`ledger/inventory.tsv` lists what channels do, and for each thing the tests
that cover it or the reason none does. `ledger/known-defects.tsv`
lists the tests that assert behaviour the product does not have yet; they are
marked `knownDefect()` and fail the run the day the defect is fixed, so the
mark gets removed. `ledger/intermittent-defects.tsv`
lists the tests with a check a defect fails only in some runs, wrapped in
`failsSometimes`; the checker reports each run in which one showed. When the
check is that an open page shows what someone else just did, and it has been seen to fail, use `arrivesLive`: it records the miss the same way,
then reloads the page and requires the check, so a change that is lost still
fails the run. Give it the arrival alone, and keep what the message says as
ordinary checks. `missedLive` is for a test that has to do something of its
own after a miss.

```sh
bun tests/channels-e2e/ledger/check.ts                      # ledger against the tests
bun tests/channels-e2e/ledger/check.ts --report <report>    # and against a run
```

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

## Writing a test

- Title: an id (`MSG-03`) then a sentence a person would say. Above it, a
  comment that starts `If this fails,` and says what a person would suffer.
- Assert what is on screen with literals. No sleeps, no waiting on requests.
- Add the id to `ledger/inventory.tsv`. Before trusting a new test, watch it
  fail: break the product where the behaviour lives and run it.
- A test that fails because the product is wrong keeps asserting the right
  behaviour, marked `knownDefect()` with the defect in a comment and a row in
  `ledger/known-defects.tsv`.
