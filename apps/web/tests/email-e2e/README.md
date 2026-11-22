# Email browser suite

The built web app in headless Chromium against the `crates/email_e2e` stack:
the real `email_service`, `pubsub_workers` and `document_storage_service`
(GraphQL), with the Gmail and Outlook emulators as the providers. Each test
gets its own stack, user and linked inbox, so tests run in parallel and share
nothing.

Use it for what only the whole path can decide: what the composer really
sends, what the list and thread view do with what the services answer, what
reaches the provider. Logic of one component belongs in that feature's
`browser-test/` fixture suite, which needs no backend and is much cheaper.

## Running

```sh
just email-e2e-browser                 # builds the services, the stack server and the bundle, then runs
just email-e2e-browser reply           # arguments go to Playwright
just apps/web/test-email-e2e-browser   # only the run, when everything is built
```

It needs what `just email-e2e` needs (`crates/email_e2e/AGENTS.md`: Postgres,
Redis, an ElasticMQ and a Kafka broker in `EMAIL_E2E_*`), the repository's
`bun install`, and Chromium (`bunx playwright install chromium`, or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). `EMAIL_E2E_BROWSER_WORKERS` sets how
many tests run at once (4); each runs three services and a browser, and half
as many stacks again wait started for the next tests (about 0.5 GB, 40
Postgres connections and one Redis database each).

On a shared host, run builds and suites under `ionice -c3 nice -n10` with
`CARGO_BUILD_JOBS=2`, `EMAIL_E2E_BROWSER_WORKERS=1` and `EMAIL_E2E_STACK_POOL=0`.
Compare bundles sequentially, keep stack data on disk, and cap service logs at
info level with bounded rotation. For long comparisons, `--trace=off` avoids
recording every asset for every page; rerun failures with tracing enabled.
Point `TMPDIR` through a short symlink when its on-disk path is long; Chromium's
profile sockets must fit the Unix socket path limit.
The isolated network helper keeps a stable dummy interface without an external
route: Chromium otherwise reports a loopback-only namespace as offline even
while the forwarded services answer. Browser offline emulation still controls
the app's disconnected paths.

## How it works

- `global-setup.ts` starts `email_e2e_stacks` (`crates/email_e2e/src/stack_server.rs`),
  which starts and stops stacks over HTTP; `harness/stack.ts` is its client.
  It keeps a stack for every two workers started ahead (`EMAIL_E2E_STACK_POOL`; `0`
  starts each when asked): a test is handed a started stack, which no other
  test gets, and the next one starts while the test runs. A test that sets
  `stackEnv` waits for a stack started with that environment.
- `harness/front.ts` gives each test one origin that serves the bundle
  (`apps/web/dist`, or `EMAIL_E2E_DIST`) and proxies `/email` and `/dss` to
  that test's services, signing each request as the test's user with the
  services' internal headers. There is no authentication service: the few
  `/auth` calls the app needs at startup are answered there. The connector
  list and catalog reads (`GET /cognition/connectors` and
  `GET /cognition/connectors/catalog`) return an empty list and catalog page,
  since the stack has no connector service. `front.stub` answers more.
  The bundle's own files reach the page from the test process
  (a route in the fixture answers with what the front would send), not over
  the network.
- The bundle is built by `just apps/web/build-email-e2e`: every service on the
  page's own origin, with the inbox re-sync control switched on
  (`VITE_ENABLE_INBOX_RESYNC`), which is off in a normal build.
- Pull-to-refresh cases silence Soup and gateway live updates while answering
  gateway heartbeats, so only the gesture can bring the next row. Settings
  recovery cases keep the list fault active until Retry requests it, then allow
  automatic recovery after releasing the fault.
- The connection gateway is not run. The fixture answers the browser's gateway
  socket and passes on what the email services ask the gateway to send the user.
- Not in the stack: the notification, search, contacts and calendar services.
  New mail does not appear in an open list by itself; sync, then open.
- The bundle has unified notifications on (`enable-unified-notifications` is
  on in dev), so the navigation's unread marks, the Mail badge among them,
  follow the server's count of unread notification rows, which only the
  notification service writes: on a test's own stack they never light. Test
  them on the full-stack tier.

`authority-requests.spec.ts` counts permission reads through inbox navigation,
thread reads and draft autosaves against the real services. Its Soup frames are
protocol fixtures: the stack's HTTP recording proxy cannot relay WebSocket
upgrades. Those counts measure client frame handling, not live Kafka delivery.

The per-test gateway exposes `mailbox.emitRefresh` for typed, synthetic refresh
frames while real server state stays unchanged. It is unavailable on the
full-stack tier. The sender-menu suite keeps first-retry traces and records menu/row state in
attachments and report annotations. Its unchanged-refresh baseline starts after
Noise loads and the menu opens; each wake waits for a newly started matching
Noise query and records before/after node facts and request/response hashes.
Scheduled-Undo failure cases silence live updates while holding the toast, so
Undo itself observes that the forced send has completed. Retry counts remain visible in the JSON
report; the suite follows the shared retry policy.

## Writing a test

```ts
import { expect, test } from './harness/fixtures';

test('a reply goes out in the thread', async ({ page, mailbox }) => {
  await mailbox.deliver({ from: 'Grace <grace@example.com>', subject: 'Lunch?', text: 'Noon?' });
  const thread = await mailbox.synced('Lunch?');       // Macro has it
  await mailbox.open(`/app/mail/${thread.id}`);
  await page.getByText('Reply...').click();
  await page.keyboard.type('Yes.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(async () => (await mailbox.providerMessages()).filter((m) => m.labels.includes('SENT')).length)
    .toBe(1);
});
```

- `test.use({ provider: 'OUTLOOK' })` links an Outlook inbox; `stackEnv` sets
  service environment; `mailbox.stack.link` links a second inbox.
- Act as the provider with `mailbox.deliver`, `mailbox.stack.seed` and the
  emulators' control APIs (`stack.info.gmailUrl`, `outlookUrl`); observe with
  `mailbox.providerMessages()`, `gmailRawMessage` (`harness/provider.ts`), the
  email API (`mailbox.api`), `stack.serviceRequests()`, `stack.storedObjects()`
  and, last, `stack.sql`.
- Leave a state the services check with the provider at the provider too:
  `lapseGrant` (`harness/ways-elsewhere.ts`) revokes the grant at the
  emulator. Setting `needs_reauth` with `stack.sql` alone lasts only until the
  services get a token for the inbox from a provider that still grants it.
- Failures of what the app depends on: `stack.failNextServiceRequest`,
  `stack.refuseQueueSends`, emulator faults, and Playwright's `page.route`.
- Mark what the test covers: `did('AL-171')` where it performs an action of
  the coverage manifest, `saw('STC-067')` where it asserts a state, and
  `confirmed('F-108')` where it asserts the function's result at the
  provider (`ledger/README.md`). New UI gets its manifest rows in the same
  change.
- Never sleep: wait with `expect.poll` and locators.
- Say in a comment above the test what goes wrong when it fails.
- A test for a bug that is not fixed yet asserts the right behaviour and is
  tagged `{ tag: '@known-bug' }`. The suite leaves it out;
  `EMAIL_E2E_KNOWN_BUGS=1` runs only those (a non-gating CI step of the daily sweep,
  on each stack). Once it passes, the coverage step fails until the tag and the
  bug's line in `ledger/waivers.tsv` are removed. A bug that shows only in
  some runs is tagged `['@known-bug', '@sometimes']`, with its rate in the
  comment: a pass of that test fails nothing.
- A new test must fail with its bug put back: build a bundle with the fix
  reverted into another directory and run with `EMAIL_E2E_DIST` pointing at it.
- A failing test prints its service log directory and keeps a Playwright trace
  in `test-results/`.

## The full-stack tier

A test's own stack runs three services. The tier runs the same suite against
one instance of the local stack (`just run_local`), so a test also goes
through the real gateway, sign-in and proxy, and can reach the services only
that stack runs (search, notifications, channels, the image proxy).

```sh
nix develop -c just email-e2e-full-stack            # starts the instance `email-e2e`, builds the bundle, runs
nix develop -c just apps/web/test-email-e2e-full-stack email-e2e reply   # only the run, on a running instance
```

- The tier runs only on an instance started with `--no-doppler`. Doppler's
  config holds real Google, model and payment keys: with them the stack
  starts no stand-ins, and its sign-ups and its assistant reach the real
  services. The recipe reads how the instance was started, and
  `checkStandIns` (`harness/local-stack.ts`) asks the Gmail and Outlook
  emulators and the model stand-in for an answer; either stops the run
  before a test signs up a user.
- A test runs there when it is tagged: `@any-stack` (on both backends) or
  `@full-stack` (only there). Untagged tests need a stack of their own: they
  break, watch or drive services, which a shared stack cannot give them.
  Tag a test `@any-stack` once it passes on both.
- `harness/local-stack.ts` is the `mailbox` fixture's second backend. Each
  test signs up a user of its own through the authentication service, links
  its mailboxes through the emulators' consent pages, and disconnects them
  when it ends. `mailbox.stack.address('grace@example.com')` answers the
  address a test should use: the emulators are shared, so each test's
  mailboxes get a domain of its own. `addMailbox` answers it too.
- What needs a stack of the test's own (service faults, the scheduled sweep,
  outbound requests) throws on the local stack and says so.
- The authentication service lets one address create 50 accounts an hour.
  The whole tier signs up from one address, so `harness/sign-up-limit.ts`
  clears that counter in the stack's own Redis before each sign-up, and only
  in a Redis on this machine. The key is read from
  `crates/macro_cache_client/src/create_user_rate_limit.rs`, and the run
  stops before its first test if a sign-up leaves no such key: change the
  harness with the service when the counter moves.
- The emulators forget everything when the stack restarts, while the
  database keeps the inboxes: inboxes left by an interrupted run keep failing
  to sync and slow every new one. Disconnect them, or start from a new
  instance.
- The `full-stack-*.spec.ts` files are the functions only this tier reaches:
  connecting through the authentication service and the providers' consent
  (including administrator approval), search, notifications and the Mail
  badge, sharing a
  thread with another user, a file too large to attach, mail on Home and
  in a contact's record, a reminder coming due, and the calendar
  (invitations, an event made from an email).
- `test.use({ access: 'mail-and-calendar' })` links the mailbox with its
  calendar too. Tests that need a ready calendar use `calendarReady` in
  `full-stack-calendar.spec.ts`. The first-sync scenario starts with an empty
  Google grant (`seedGoogleGrant: false`), so the mail-only connection has no
  calendar. It delays discovery on the mailbox linked with calendar access and
  uses both actions before discovery finishes.
- `tickReminders` (`harness/organise.ts`) runs the reminder sweep there by
  queueing it on the stack's own queue. It sweeps for every user, so a
  test asserts only on its own threads.
- A list keeps paging in older mail for a while after it opens, which also
  brings in new mail. A test of the live update waits until that paging
  is finished (`backfilled` in `full-stack-notifications.spec.ts`).
  `askAs(user, path)` asks a service as another signed-in user.
- The assistant never calls a model there. The stack runs a stand-in for
  the model (`crates/model_emulator`) that answers from scripts:
  `harness/model.ts` adds one (`scriptModel`: the model's turns, each text
  or tool calls), and the conversation whose message carries
  `scriptMarker(name)` is answered from it. The stand-in is shared, so a
  test names its script with `scriptName`. `modelRequests(name)` answers
  what the assistant sent, tool declarations included.
  `full-stack-assistant.spec.ts` drafts an email for review and reads mail
  through scripted tool calls this way. Type the entry point of each scripted
  ExecuteCode program with the ambient `CodeContext` so the real checker can
  validate the SDK calls before execution.
- The tier writes its evidence to `ledger-results/full-stack/`, and the
  report counts it together with the per-test run's. What only the tier
  covers is listed in `ledger/full-stack-only.tsv` (`ledger/README.md`):
  after moving a test between the stacks, run both and
  `just apps/web/email-e2e-ledger --record`.

## CI

The suite is not part of `PR CI` and does not count towards `CI gate`. Three
workflows run it (`xtask_workflows`' `email_e2e.rs`, `email_e2e_browser.rs`
and `email_e2e_full_stack.rs`):

| Job | Push to `main` | Daily sweep, 21:00 UTC | By hand |
| --- | --- | --- | --- |
| `Email end-to-end`: the Rust scenarios | when backend code changed | yes | yes |
| `Email end-to-end (browser)`: this suite, on three machines | when the web app or backend code changed | yes | yes |
| `Email end-to-end (browser) coverage`: `email-e2e-ledger --enforce` | with the suite | yes | yes |
| `Email end-to-end (full stack)`: the tier, its `@known-bug` tests and its coverage check | no | yes | yes |
| The `@known-bug` report of the first two (non-gating) | no | yes | with `known_bugs` |

- Pushes to `main` queue as the dev deploys do: one run at a time, and a newer
  push replaces the one waiting, whose changes the next run tests with its
  own ([CI on pull requests](../../../../docs/development/ci.md#email-end-to-end-suites)).
  A failure is a red run on the commit it tested; nothing is reverted or
  blocked by it.
- Each workflow's last job, `Tell Macro Alerts`, posts to the Macro Alerts
  channel when its pushes to `main` or its sweep turn red, and when they pass
  again; never for a run by hand. What the alert says, and what to do about
  it: [CI on pull requests](../../../../docs/development/ci.md#when-an-email-end-to-end-alert-fires).
- The sweep runs `main`'s head whether or not it changed. Cron is UTC and
  does not follow daylight saving: 21:00 UTC is 4pm EST and 5pm EDT.
- The coverage check fails the run wherever the suite runs: on the pushes to
  `main` and in the sweep (the tier's own in the sweep). That a test for a
  known bug now passes is found by the sweep, where those tests run.
- The browser workflow splits the suite over three machines (Playwright's
  `--shard`, `SHARDS` in `email_e2e_browser.rs`); each uploads what it
  recorded, and the coverage job reads all of it as one run. Raise `SHARDS`
  when a shard passes about fifteen minutes.

A pull request that changes email, calendar or the suite is run by hand
before it is merged, since `PR CI` does not:

```sh
gh workflow run email_e2e_browser.yml --ref <branch>                  # what a push to main runs
gh workflow run email_e2e.yml --ref <branch>
gh workflow run email_e2e_browser.yml --ref <branch> -f known_bugs=true   # as the sweep
gh workflow run email_e2e_full_stack.yml --ref <branch>
gh run list --workflow email_e2e_browser.yml --branch <branch> --limit 1
```

The run is of the branch as it is, not of its merge with `main`: merge
`main` in first when that matters. GitHub starts a workflow by hand only
once its file is on `main`.

## What the suite covers

Every run records what each test did (the manifest rows it marked, the
functions it did and checked, the requests the app made) under
`ledger-results/`. `just apps/web/email-e2e-ledger` turns the last run into
a report: first the functions of email (draft, send, mark done, star...)
covered on Gmail and on Outlook, then the actions, states and network
operations under them, by provider and layout, what no test covers, and
where the manifest differs from the code. CI's coverage job appends it to its summary and uploads it as the
`email-e2e-browser-coverage` artifact, and fails when a function or
a row has neither a passing test nor a line in `ledger/waivers.tsv`. See
`ledger/README.md`.

## What is here

One spec file per area; helpers a file shares with others are in `harness/`.

| Files | Area | Helpers |
| --- | --- | --- |
| `reply`, `send-*`, `compose-*`, `scheduled-failure` | starting and writing a message, what a reply, forward or new message sends, undo, send outcome, a scheduled send that failed | `harness/send.ts` |
| `draft-*`, `attachment*`, `signature` | draft saving, discarding and recovery, attachments, the editor, the signature | `harness/drafts.ts` |
| `list*`, `state`, `inbox`, `folders`, `saved-views` | the list, its views, controls and search, Done and read state, inbox selection, Sent, folders | `harness/list.ts` |
| `organise-*`, `labels`, `reminders` | marking, moving and muting threads and senders, labels, reminders | `harness/organise.ts` |
| `thread*`, `render` | the thread view, opening from search, pictures in a message | `harness/thread.ts` |
| `link*`, `connect-more`, `settings-accounts` | connecting, reconnecting and sharing inboxes, calendars, onboarding | `harness/linking.ts` |
| `sync-provider*` | what reaches the app from the provider: existing and new mail, changes made in the provider's own client, threading, classification | `harness/sync.ts` |
| `sharing`, `elsewhere`, `entitlement` | sharing a thread and access requests, mail shown outside Mail, an account without email | `harness/sharing.ts` |
| `calendar-invitation`, `invitation-actions` | the invitation card in a thread and its actions | |
| `ways-<area>-*` | the other ways into a function: each menu entry, button, shortcut and phone control that does what another test already does through one of them. One test walks every way into a function in turn and checks the same outcome for each | `harness/ways-<area>.ts` |
| `states-<area>-*` | what the app shows besides a function's result: hints, disabled and busy controls, empty and loading states, and the notice of each failure, one assertion for each state row of the manifest. A failure is made by holding or failing the request the state waits on | `harness/states-<area>.ts` |
| `ledger/` | the coverage manifest, the recorder and the report | |
| `journey-*` | whole user journeys for a Gmail and an Outlook inbox: a mail day, a new message, scheduled send, triage, a received attachment, phone width, Settings › Email | `harness/journeys.ts` |

- `harness/linking.ts` stands in for the authentication service's link
  endpoints and the provider callback; the consent pages are the emulators'.
- `list.spec.ts`'s new-mail test runs only with `EMAIL_E2E_LIVE_UPDATES=1`
  and alone: every stack's services read live updates in one Kafka consumer
  group, so another running stack can take the event.
  The per-test stack's recording proxy currently buffers HTTP responses and
  removes `Connection`; it does not relay WebSocket upgrades. Its Soup socket
  therefore fails the handshake even with a private broker, and the readiness
  probe fails before the test exercises list updates. Live subscription delivery
  remains unverified by this test until the proxy supports upgraded connections.

## Fixture tests

Bugs that one component decides are covered in the features' `browser-test/`
suites instead (the email composer, the calendar, event details, signatures,
unavailable mentions) and in `packages/email-renderer`. `just
apps/web/test-email-fixtures-browser` runs the ones that cover an email or
calendar bug class; the recipe lists them. The CI job runs it beside this
suite. `src/features/calendar/browser-test` mounts the calendar over scripted
`/calendar` routes until `calendar_service` is part of the stack.

The full-stack onboarding tests use unique synthetic addresses in the local Gmail
and Outlook emulators’ native domains to exercise the direct provider buttons.
A recognized catalog or unambiguous MX hint can offer IMAP when its rollout is
enabled. Unknown or reserved lab domains use the chooser’s manual Other email
(IMAP / SMTP) path; the lab does not override product routing.

### IMAP and SMTP

Run `just imap-e2e-browser` for the desktop and phone IMAP enrollment and reply
cases. This tier uses the authenticated local stack, a Dovecot IMAP and
submission server, and Mailpit. The independent test client appends the inbound
message over IMAP and reads the resulting SMTP reply through Mailpit. The
full-stack CI job requires both layouts to save and reopen folder settings,
reconnect the same account, and record the visible confirmations and real
browser API requests in the coverage ledger.

To inspect enrollment in local Tempo, run the same no-Doppler stack with
`--traces lgtm` and build the full-stack web bundle with
`VITE_ENABLE_BROWSER_OTEL=true`, `VITE_OTEL_ENV=local` and
`VITE_OTEL_EXPORTER_URL=/i/otlp/v1/traces`. Run
`just apps/web/test-email-e2e-full-stack imap-mail full-stack-imap`.
Each case records its enrollment trace ID in the Playwright JSON report's
`imap-enrollment-trace` attachment. Look up that ID in local Tempo to follow
the browser request through the email and IMAP services. Playwright's network
trace stays off because the enrollment request contains the lab password.
