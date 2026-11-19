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
| `VITE_ENABLE_GRAPHQL_SOUP` | Set to `true` when the app under test was built with it, as CI does for both the build and the run: some known defects exist only with the flag, others only without. |

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
  services (`serverChannel`). The tests of a device that keeps channels
  (`current`, `offline`, `writes`, `prewarm`) end on three things that must
  agree: the lines the test expects, the screen, and the services.
- `harness/history.ts` makes one long channel (230 messages, a 30-reply
  thread far back) before the first test and keeps it for later runs against
  the same stack. Tests only read it.
- Every other test makes the channels it needs, with unique names, so tests
  run in parallel in any order.

## The ledger

`ledger/inventory.tsv` lists what channels do, and for each thing the tests
that cover it or the reason none does. `ledger/proofs.tsv` names, for each
test, a deliberate break of the product that made it fail, and
`ledger/breaks/` holds those breaks as patches. `ledger/known-defects.tsv`
lists the tests that assert behaviour the product does not have yet, and
whether that is in builds without `VITE_ENABLE_GRAPHQL_SOUP` (`off`), with it
(`on`) or `both`; they are marked `knownDefect(...)` and fail the run the day
the defect is fixed, so the mark gets removed. `ledger/intermittent-defects.tsv`
lists the tests with a check a defect fails only in some runs, wrapped in
`failsSometimes`; the checker reports each run in which one showed.

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
  nothing for a while is the step under test (PRE-01 to PRE-05, REC-04). The one read
  of what a page has fetched is `codeFetched`, with which `goOffline` lets a
  page finish fetching the app's code before it cuts it off: no test asserts
  on it.
- A test of what only a build with `VITE_ENABLE_GRAPHQL_SOUP` does (channels
  kept on the device, writes that wait there) skips itself on other builds
  with `test.skip(!SOUP_BUILD, ...)`, and its proof is run on a build with
  the flag.
- A test that runs on both builds and reads messages needs a proof on each:
  with the flag, messages come through `src/lib/queries/messages/local/`,
  and a break of the other path leaves the test passing.
- Add the id to `ledger/inventory.tsv`, then prove the test can fail: break
  the product where the behaviour lives, build the bundle, watch the test
  fail, and record the break in `ledger/proofs.tsv` and `ledger/breaks/`.
- A test that fails because the product is wrong keeps asserting the right
  behaviour, marked `knownDefect('both')` (or `'off'` / `'on'` when only one
  build has the defect) with the defect in a comment and a row in
  `ledger/known-defects.tsv`.
