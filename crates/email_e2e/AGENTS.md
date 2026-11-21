# email_e2e

## What it is

The end-to-end test suite for Email and Calendar: the real `email_service` API, its
`pubsub_workers` (queue workers and the Outlook mailbox loops) and, when a
scenario asks, `calendar_service` run as
processes against `gmail_emulator` and `outlook_emulator`, with their own
Postgres database, Redis database and SQS queues. A scenario drives them the
way a user and a provider do. `src/` is the harness; `tests/` holds the
scenarios.

## How it works

- `Stack::start()` gives one scenario its own stack: both emulators, a
  database cloned from a migrated template, a leased Redis database, the
  production queues with their dead-letter queues, an in-memory S3 and CDN
  (`src/aws.rs`), stand-ins for the other Macro services that record what
  they were asked (`src/macro_services.rs`), and the two service processes.
- `Stack::start_with(StackOptions { document_storage: true, .. })` also
  starts the real `document_storage_service` on the same database, Redis
  database, queues and providers: it serves the GraphQL API the web app
  sends mail through. It is a third large process, so only scenarios that
  need it ask for it. On such a stack the stand-in for document storage
  records what the email services ask and passes it on to this process, so
  attachments become real documents.
- `StackOptions { search: true, .. }` adds the real search indexer
  (`search_processing_service`) on top of document storage: it follows the
  mail's Kafka events into OpenSearch, and document storage answers
  `POST /search` from it. The indexer's consumer group is one for every
  scenario: the harness gives it an offset wherever it has none, so an
  indexer misses nothing published while it joins, and each indexer goes on
  from where the last one stopped. Events of other scenarios in between
  name mail that is not in this scenario's database and are passed over.
- `StackOptions { outlook_import_live_pass: true, .. }` turns on the Outlook
  import live pass (`enable-outlook-import-live-pass`): the email services
  read the flag from the Macro services stand-in, which answers PostHog's
  `/flags/` with it on, and `Stack::start_with` returns once the workers'
  log shows they read it. Off by default, as in production.
- `StackOptions { focus: true, .. }` adds the real `email_focus_worker`,
  which classifies arriving mail for Focus from the mail's Kafka events, and
  stand-ins for the three things it asks outside the database
  (`src/focus.rs`): the model that answers the Focus questions, reached
  through `OVERRIDE_TYPESAFE_API_URL`; the agent harness route that reads
  the day a thread is due and the day of the meeting it is about, through
  `OVERRIDE_AGENT_HARNESS_SERVICE_URL`; and PostHog's flag definitions, through `POSTHOG_HOST`, from which it reads
  whether an inbox's owner, or a user it is linked to, has the
  `enable-email-focus` flag. Its
  pushes go to the connection gateway stand-in like every other service's.
- Scenarios run in parallel and share nothing but the servers (Postgres,
  Redis, SQS, Kafka, and OpenSearch for search).
- The services are the binaries in `target/debug` (or `EMAIL_E2E_BIN_DIR`),
  started with an environment the harness builds (`src/stack/environment.rs`)
  and the dev shell’s native `LD_LIBRARY_PATH` for dynamically linked Nix
  binaries. No other parent service settings are inherited. Build them before running; `just email-e2e` does.
- Each scenario's service logs are in
  `target/debug/email-e2e/<test>-<id>/{email_service,pubsub_workers,calendar_service,document_storage_service,search_processing_service,email_focus_worker}.log`,
  with `<handler>.log` for each Lambda the scenario ran.
  A failing scenario prints the directory and the end of the logs.

## Writing a scenario

Real IMAP scenarios set `StackOptions { imap: true, .. }`. Prepare and start
`docker/imap-lab` first, and build `imap_service` alongside the email binaries.
`user.link_imap()` uses the authenticated connection API and returns the link
UUID. `stack.imap_lab()` controls Dovecot through an independent Python IMAP
client and reads Mailpit; it never uses the engine's index as its provider
oracle. Each unique user has a separate real mailbox. The existing `Provider`
helpers remain specific to the Gmail/Outlook emulators.

Run `cargo test -p email_e2e --test imap` with the infrastructure settings below.
The optional engine is stopped before the scenario database is released.

```rust
use email_e2e::{Mail, Report, Stack};

#[tokio::test(flavor = "multi_thread")]
async fn new_mail_arrives_through_push() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;      // a Macro user, ada@example.com
    let inbox = ada.link_gmail().await?;     // or link_outlook(); waits for the first sync

    inbox.deliver(&Mail::new("Grace <grace@example.com>", "Lunch?", "Noon?"))?;
    let preview = inbox.wait_for_preview("inbox", "Lunch?").await?;
    assert_eq!(preview["isRead"], false);

    stack.finish().await                     // fails if a service died or panicked
}
```

- Act as the user through `Inbox`/`User` (`get`, `post`, `patch`, `send`,
  `save_draft`, `attach_to_draft`, …: the service's HTTP API with the
  internal auth headers) and as the provider through `Inbox::deliver`,
  `set_read_at_provider`, `expire_access_tokens`, or the emulators themselves
  (`stack.gmail()`, `stack.outlook()`: faults, clock, request log, seeds).
- Observe through the API first; then the provider (`provider_messages`), what
  the services told other services (`stack.service_requests()`,
  `stack.stored_objects()`, `stack.take_queue_messages(queue)`,
  `stack.dead_letters(queue)`, `stack.email_events(link_id)`), and the database (`stack.db()`) last.
- Wait with the `wait_for_*` methods or `eventually`; never sleep. A wait
  ends when its condition holds, so the 120 s limit only costs time on failure.
- To prove something does *not* happen, make a later event happen and wait
  for that (deliver a second mail, then assert the first has no duplicate).
- The scheduled-send cron: `stack.run_scheduled_sweep()` runs the real
  `email_scheduled_handler` once. The other Lambdas run the same way, each
  from its own binary, which must be built as well:
  `stack.run_link_cleanup()` (`user_link_cleanup_handler`),
  `stack.run_stored_file_cleanup()` (`email_sfs_delete_handler`, which
  enqueues on `sfs-delete`), `stack.notify_of_mail_feedback(&notification)`
  (`email_suppression_handler`, one bounce or complaint) and
  `stack.run_refresh()` (`email_refresh_handler`, the hourly link
  maintenance: a `HealthCheck` on `link-maintenance` for every syncing Gmail inbox, and
  a `Refresh` for those whose hour it is, which a scenario cannot count
  on). See `tests/maintenance.rs`. Work of the other crons is enqueued by the
  scenario: `stack.send_to_queue("link-manager" | "sfs-delete", …)`, and on a
  stack with `document_storage` the reminder sweep tick
  (`"reminder-dispatch"`, `{ "operation": "sweep" }`).
- One file per area in `tests/` (`gmail.rs`, `outlook.rs`, …); each file is a
  test binary, so keep shared helpers in the harness, not in `tests/`. Helpers
  only one area's files use sit in `tests/<area>_support/`, which is not a
  binary, and each file includes them with `#[path]` (`send_support`).
- Every scenario is `#[tokio::test(flavor = "multi_thread")]`: the stack's
  cleanup after a failure needs a second runtime thread.
- Name the test for the behaviour, and say in its doc comment what goes wrong
  when it fails.
- A scenario for a bug that is not fixed yet asserts the right behaviour and
  is marked `#[ignore = "known bug: <class id>"]`. The suite skips it; `just
  email-e2e-known-bugs` (in CI a job of the daily sweep that never fails for
  a scenario) runs only those and reports which still fail and which now
  pass. Remove the attribute with the fix:
  the coverage job fails on one that passes. `#[ignore]` is for known bugs
  only, always with that reason.
- A scenario that fails is tried once more (`retries = 1` in the nextest
  profile); one that passes only then is reported as needing a retry, in
  `target/nextest/email-e2e/junit.xml` and the coverage report. Treat it as
  a defect of the scenario or the product, not as passing.
- Sending the way the web composer does (a stack with `document_storage`):
  `inbox.send_attempt(attempt_id, &message, &extra)` with the GraphQL draft
  input (`draftId`, `subject`, `to`, `bodyText`, …), then `cancel_send`,
  `send_attempt_state`, `pending_sends` (the unsettled Sends of all the
  user's inboxes) and `wait_for_send_attempt(attempt_id, "SENT")`. The
  undo window is `SENT_UNDO_DELAY_SECS` (1 s); a scenario that undoes sets
  it longer through `StackOptions.env`. Any other query or mutation:
  `user.graphql(query, &variables)`. See `tests/send_attempt.rs`.
- The lists and item routes document storage serves (a stack with
  `document_storage`): `user.email_list_page(request, cursor)` is the email
  threads of an item list as the web app asks for them (filter `ef`, CRM
  scope `ecd`, `emailView`, `limit`); any other route:
  `user.document_storage_request(method, path, body)`. See `tests/lists.rs`
  and `tests/crm.rs`, which seeds a team and its CRM rows in the database
  because the services that create them are not started.
- The email tools an AI agent calls: `stack.email_tools()?.call(&user,
  "GetThread", &json!({ .. }))` runs a tool in the test process on the
  scenario's database and queues, and the scenario's workers carry out what
  it stages. No model and no tool host is involved: a host's own wiring
  (which queues it configures) is not exercised. `SendEmail` defers to a
  composer; `SendConfirmedEmail` sends. Give a sending tool the base64url
  HTML a composer exports, since no Markdown renderer is started. The test
  file needs `#![recursion_limit = "256"]`. See `tests/ai_tools.rs`.
- Search (a stack with `search`): `user.search(&request)` is `POST /search`
  with the body the web app sends; wait for a search to find the mail,
  since indexing follows the sync. The index and the indexer's consumer
  group are shared, so give each user an address of its own with
  `stack.unique_user(name)`, and keep search scenarios in `tests/search.rs`,
  whose tests nextest runs one at a time.
- Focus (a stack with `focus`, and `document_storage` to read it as the web
  app does: `user { emailFocus }` and a thread's `focus`): the model finds
  no mail worth Focus until the scenario names text such mail holds,
  `stack.focus_classifier()?.put_in_focus_when_mail_contains("Contract
  renewal")`; `due_on_when_mail_contains` sets the day the harness reads
  as due and `event_on_when_mail_contains` the day of the meeting it is
  about, and `times_asked_about(text)` tells whether mail reached the
  model at all; `stack.focus_worker_log()` is what the worker logged. The questions and their order are the product's: the
  stand-in answers yes only to the first, "would the owner want this in
  Focus", and, for text named with `ask_the_owner_when_mail_contains`, to
  whether the latest message asks the owner something they haven't answered. The worker classifies an inbox only while its owner, or a user it
  is linked to, has the Focus flag: every user has it unless the scenario turns it off with
  `turn_off_focus_flag_for(address)` before linking any inbox, since the
  worker reads the flag on its first look at the inboxes and again only
  five minutes later. It also needs that person to use Macro: every user
  the harness makes has Macro open (`User::create` records them as seen,
  as the connection gateway does), `user.away_for(duration)` makes them
  someone who stopped, and `user.opens_macro()` brings them back. The
  worker keeps that answer for `FOCUS_ACTIVITY_CACHE_SECS` (300 s); a
  scenario about leaving and coming back sets it to 0 through
  `StackOptions.env`. `stack.focus_skipped_without_flag(thread_id)`
  tells that the worker is done with a thread and left it unclassified
  because nobody whose tab shows it is in the rollout; it reads a debug line the
  stack's `RUST_LOG` for the worker turns on, so a scenario that sets
  its own `RUST_LOG` loses it. Classifying follows
  the sync, so wait for the list or the thread's `focus`. Keep these
  scenarios in `tests/focus.rs`, whose tests nextest runs one at a time.
- Mail that must be in the mailbox before it is linked: `stack.seed_mailbox`.
- Mail written at a given time, for a wait or a day already past: `Mail::dated`;
  mail the owner sent from another mail client (Gmail's `SENT` label, Outlook's
  Sent Items): `Mail::sent_from_mailbox`.
- The labels the owner made at the provider (Gmail labels, Outlook
  categories): `stack.provider_labels(&inbox)` reads them and
  `stack.make_provider_label(&inbox, name)` makes one, through the
  provider's own API as another mail client would. See
  `tests/journey_parity.rs`.
- Linking Gmail the way signing in with Google does:
  `user.link_gmail_through_sign_in()`, after `stack.gmail().add_mailbox`
  with the `scopes` the grant should hold. Macro asks the emulator's
  tokeninfo which scopes it has. See `tests/journey_connect.rs`.
- A user at an address that matters (a staff domain): `stack.user_at`.
- Failures of what the services depend on: a provider fault on the emulator,
  `stack.fail_next_service_request` (`_with` for a JSON body) for another
  Macro service,
  `stack.hold_next_service_request` keeps a call waiting until the scenario
  releases it, to change things between a service's request and its answer.
  `stack.refuse_queue_sends` for an enqueue (`queue_send_refusals_left`
  tells that the services met it). `stack.redis()` reaches the services'
  Redis database.

## Calendar scenarios

```rust
let stack = Stack::start_with(StackOptions { calendar: true, ..StackOptions::default() }).await?;
let ada = stack.user("ada").await?;
ada.link_gmail_with_calendar().await?;   // or link_outlook_with_calendar(); waits for both first syncs
let calendar = ada.calendar()?;
stack.gmail().add_event(ada.email(), "primary", event)?;   // the provider's side
let item = calendar.wait_for_event("Standup").await?;      // { event, occurrence }
calendar.patch(&format!("/events/{}", item["event"]["id"].as_str().unwrap()), &change).await?;
```

- `StackOptions::calendar` adds `calendar_service` (its log is next to the
  others), its backfill queue, and the calendar read routes. Without it a
  stack is exactly the email one.
- `Calendar` talks to two places, as the web app does: changes go to
  `calendar_service` under the gateway's `/calendar` prefix (`get`, `post`,
  `put`, `patch`, `delete`, `request`), which is also where Google pushes
  (`/calendar/notifications`); reads go to `/calendar-events...` (`read`,
  `occurrences`, `wait_for_event`, `wait_for_occurrences`, `wait_until_gone`).
- The read routes belong to `document_storage_service` in production. The
  harness does not start that service: it serves the same `calendar_events`
  routers in-process on the scenario's database (`src/stack/calendar_reads.rs`),
  and records what the join request service would send to notifications and
  the connection gateway (`stack.calendar_signals()`). What
  `calendar_service` itself tells the gateway is in `stack.service_requests()`.
- Google changes arrive by push. Outlook has no calendar push: after changing
  an Outlook calendar call `calendar.poll_outlook_now(address)`, which stands
  in for the two-minute poll.
- A push from Google that finds a sync round under way starts no new round
  (known bug `cal-google-push-during-sync-dropped`): call
  `calendar.wait_until_synced(address)` between one change at Google and the
  next, or the second can be missed.
- `events::{google, google_with, outlook, outlook_with, hour_in_days}` build
  provider events. Team, channel-share and notification rows have no API in
  the stack: the scenarios that need them insert the rows the other services
  would (`tests/calendar_team.rs`, `tests/calendar_shares.rs`).
- Scenarios live in `tests/calendar_*.rs`: `sync` (import, push, poll,
  failures), `outlook`, `events` (occurrences, guests, series), `guests`
  (guest permissions), `identity` (which inbox acts), `shares` (channel
  shares, copies, requests to join, booking), `team` (out-of-office overlay).

## Coverage

What the suite covers is measured, in functions of email first (star a
thread, refresh a token: `apps/web/tests/email-e2e/ledger/functions.tsv`,
shared with the web app's suite) and backend entry points second.

- Every scenario that ends with `stack.finish()` and healthy services
  leaves `evidence.json` in its log directory (`stack.evidence_path()`):
  the routes the API served with the shape of each request, the GraphQL
  queries document storage answered, the queue messages workers handled,
  the lambda and agent tool runs, the provider methods called, the events
  published and what was sent to other services, with the id of the
  nextest run it is of (the report counts a record only for that run). It records what happened
  until the scenario ended, after the Outlook work that was due.
  Gmail token requests are those the authentication stand-in passed on
  (`provider gmail:oauth.token`); the Gmail emulator's request log has none.
- A record holds shapes, not content (`src/evidence.rs`): route templates,
  operation names and field names. A string value is kept only under a key
  in `KIND_KEYS` (and only when it reads as a short tag) or, in a query
  string, when it is `true` or `false`; every other string becomes `<str>`,
  a number `0` (booleans stay), and a path segment that is not a plain
  word `{}`. GraphQL documents are stored without the contents of their
  string literals. When
  the report must tell two requests apart by a value, add its key to
  `KIND_KEYS`, only if every value under that key is the name of a kind
  and never something a person typed, and cover it in `src/evidence/test.rs`.
- `coverage/entrypoints.tsv` lists every backend entry point and is
  generated from the code: `cargo x email-coverage list`. CI fails when it
  is out of date.
- `coverage/functions.toml` says how the backend carries each function out:
  the request that performs it (`by`), what must reach each provider
  (`gmail`, `outlook`), and the entry points that take part (`also`). A
  function the browser does alone says so (`ui`); one another service
  carries out where no stack records it says which (`outside`) and is
  deferred to the full-stack tier, out of the count. One a known product
  bug breaks says which (`bug = "<short id>"`): it stays open whatever
  scenarios show, and the report names the bug, until the line goes with
  the fix. Routes of document storage that scenarios do record
  (lists, search, reminders, tags) are listed by hand in `sources.toml`
  (`[[elsewhere]]`). Every
  entry point belongs to a function or to `[plumbing]`; every function in
  the list has an entry. The report fails otherwise, so a new route or a new
  function cannot go unmapped.
- `coverage/checks.tsv` names the scenarios that check a function's result.
  A function is **claimed** on a provider when such a scenario passed there
  and its record shows the function performed; **performed** when scenarios
  did it and none is listed. When you write a scenario that asserts a
  function's result at the provider and in what the service returns, add
  its row.
- `coverage/proofs.tsv` (`function`, `provider`, `scenario`, `break`) names
  the breaks that proved a claim: with that one thing broken in product
  code, the scenario failed on that provider. A claimed function with such
  a row is **proved**, and only proved counts as covered in the headline.
  Add a row only after watching the scenario fail with the break in and
  pass with it out. A row that names an unknown function, provider or
  scenario fails the report; one whose scenario no longer performs and
  checks the function is reported as stale.
- `coverage/waivers.toml` holds what is left uncovered, with the reason:
  functions and entry points waived for good (`[[function]]`,
  `[[entry_point]]`), entry points deferred to the full-stack tier
  (`[[deferred]]`, counted apart from waived), and entry points nothing in
  the repository calls (`[[dead_code]]`: waived, and listed in the report
  under "Dead code candidates" with their source).
  Entry points the functions of another product call are not waived:
  `[[owned]]` with `owner = "calendar"` (the calendar provider methods)
  keeps them out of every email total and lists them under "Counted with
  the calendar functions" and in `coverage.json` (`owned`), with whether a
  scenario reached each. An owned entry point cannot also be waived,
  deferred, dead code or named in `functions.toml`.
  A scenario kept for a known bug whose bug shows only now and then is
  named under `[[intermittent_bug]]`, so that it may pass.
  The file is the one place that says why something is left: every entry
  needs its own reason. A dead-code reason starts with `unreachable:
  candidate for removal`; do not write a scenario for such an entry point.
  An entry point the product cannot reach on one provider is not waived:
  give it `[[applies]]` in `coverage/sources.toml` and regenerate the list.
- `just email-e2e-coverage` after `just email-e2e` writes the report to
  `target/email-e2e-coverage/` (`index.html`, `coverage.md`,
  `coverage.json`). In CI the `Email end-to-end (coverage)` job puts it in
  the job summary and the `email-e2e-coverage` artifact, and runs it with
  `--enforce`, so each gap fails the job and is printed as a `gap:` line
  and listed under "Gaps": a scenario that failed; a function that is not
  proved on a provider and neither waived, deferred nor held open by a
  known bug; an entry point neither reached, waived nor deferred (one whose
  functions are all held open by a known bug on that provider is let
  through); a waiver, deferral or proof the records contradict; and, with
  `--known-bugs <dir>` (the results of the known-bug jobs), a scenario kept
  for a known bug that passes and is not under `[[intermittent_bug]]`.
  Without `--enforce` the same list is only reported.
- `tests/email_policy.rs` exercises `PopulateCrmPolicy` through the real outbox
  and queue on both providers, including replaced generations and duplicate
  delivery. It seeds private rule storage; authenticated activation and preview
  controls are covered in the CRM crate.
- A new route, resolver, message type or provider method therefore needs,
  in the same change, a scenario that reaches it or an entry in
  `coverage/waivers.toml`; a new function needs a scenario, a row in
  `checks.tsv` and a proof.
- When a known bug is fixed its scenario starts to pass and the coverage
  job fails: remove the `#[ignore]` and the function's `bug` in
  `functions.toml`, and give it checks and proofs.

## Start here

- `tests/gmail.rs`, `tests/outlook.rs`: one worked scenario per provider.
- `tests/journey_*.rs`: whole user journeys (compose, organise, read,
  account, sender rules, agent, provider parity, connect, follow-up),
  each for Gmail and Outlook where the product has both.
- `src/stack.rs`: `Stack`, what it starts and what a scenario can ask it.
- `src/inbox.rs`, `src/user.rs`: the scenario's vocabulary.
- `tests/evidence.rs`: what a scenario's record holds.

## Scope

- Owns: the harness and the email and calendar scenarios.
- Not here: the fakes of Google and Microsoft → `crates/gmail_emulator`,
  `crates/outlook_emulator`. Tests of one crate's logic → that crate.
- The web app against this stack: `apps/web/tests/email-e2e` (its README).
  `src/stack_server.rs` and the `email_e2e_stacks` binary serve stacks over
  HTTP for it, one per browser test; add a route there when a browser test
  needs another of the harness's levers. With `EMAIL_E2E_STACK_POOL` set it
  keeps that many stacks started ahead of the tests
  (`src/stack_server/pool.rs`); a stack is still handed to one test only.
- Not started yet: the real notification and
  authentication services. `document_storage_service` is
  started for its GraphQL API, its lists and, on a stack with `search`,
  search over mail; its document and AI features run on placeholder
  settings.

## Checks

- `just email-e2e` (in `nix develop`), with `EMAIL_E2E_SQS_URL` pointing at
  an ElasticMQ, `EMAIL_E2E_KAFKA_BROKERS` at a Kafka broker, and Postgres and Redis from `DATABASE_URL`/`REDIS_URI` or
  `EMAIL_E2E_DATABASE_URL`/`EMAIL_E2E_REDIS_URL`.
- The search scenarios also need `EMAIL_E2E_OPENSEARCH_URL`: an OpenSearch
  with the `analysis-icu` plugin (`infra/local/opensearch/Dockerfile`) and
  the indices created once, in `infra/stacks/opensearch/helpers`:
  `ENVIRONMENT=local DRY_RUN=false OPENSEARCH_URL=$EMAIL_E2E_OPENSEARCH_URL
  OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=admin bun run
  scripts/create_indices.ts`.
- `just email-e2e` also builds `email_focus_worker`, `search_processing_service` and
  `document_storage_service`, whose build
  needs the repository's `bun install` or `CODE_MODE_ASSETS_DIR` pointing
  at `nix build .#code-mode-assets`.
- No ElasticMQ at hand: `docker run -p 9324:9324
  softwaremill/elasticmq-native:1.7.1`, then
  `EMAIL_E2E_SQS_URL=http://127.0.0.1:9324`.
- A new or changed scenario: `just email-e2e --stress-count 20 <name>` passes.
- CI: the `Email end-to-end` workflow (`xtask_workflows`' `email_e2e.rs`)
  runs the suite on pushes to `main` that change backend code and in the
  daily sweep (21:00 UTC), which also runs the scenarios for known bugs.
  It is not part of `PR CI`: run a pull request branch by hand with `gh
  workflow run email_e2e.yml --ref <branch>` (add `-f known_bugs=true` for
  the known bugs too; `docs/development/ci.md`).
  Its jobs run side by side: the scenarios without search in three parts
  (nextest `--partition`), the search scenarios with OpenSearch, and the
  scenarios for known bugs. A last job enforces the coverage, and reads the
  results of the known-bug runs where there are any. A scenario outside
  `tests/search.rs` that sets `StackOptions::search` has no cluster in CI:
  keep search scenarios in that file.
  `Email end-to-end (browser)` (`email_e2e_browser.rs`) runs the browser suite.
  The last job of each, `Tell Macro Alerts` (`email_e2e_alert.rs`), posts
  to the Macro Alerts channel when the pushes to `main` or the sweep turn
  red and when they pass again; what to do then is in
  `docs/development/ci.md` ("When an email end-to-end alert fires").
- A change to `src/stack_server.rs`: `just email-e2e-browser`.

## Gotchas

- The default nextest profile leaves this package out; a bare `cargo test -p
  email_e2e` runs it but needs the servers and the built binaries.
- The services' provider retries follow production timings: a queue message
  that fails is redelivered after its 60 s visibility timeout, and Outlook
  backs a mailbox off for `Retry-After` (30 s without one). Give faults a
  short `Retry-After` and expect Gmail fault scenarios to take about a minute.
- Add to the harness's public surface; do not change or remove what
  scenarios already use.
- Linking goes through `in_progress_user_link` and `POST /email/init`, not
  the browser OAuth pages; a user may link two inboxes before needing the
  `professional_subscriber` role.
- Kafka topics are shared by every scenario. The email services only need
  the broker to accept what they publish. `document_storage_service` reads
  topics and exits at startup when one is missing, so every stack creates
  the missing topics before it starts a service and waits until the broker
  serves them all: a fresh broker answers that a topic it was just told to
  create does not exist until it has applied that, which on a CI runner
  took up to 18 s behind the 50 partitions of `__consumer_offsets` (CI's
  broker now makes one). Document storage's consumers share their groups
  across scenarios: an event one scenario publishes may be read by another
  scenario's process, so do not assert on what that service does with
  Kafka events.
- One search indexer at a time: every indexer is in the consumer group
  `search-processing-service`, so two of them split the topics between
  them and each misses the other's share. The `email-e2e-search` test
  group in `.config/nextest.toml` runs `tests/search.rs` serially; a bare
  `cargo test` runs its tests in parallel and they fail.
- One Focus worker at a time: every worker is in the consumer group
  `email-focus`, so two of them split the mail events between them. The
  `email-e2e-focus` test group runs `tests/focus.rs` serially. The harness
  gives the group an offset before its first worker starts, so mail that
  arrives while a worker joins is still read. The worker's later sweeps
  are an hour apart unless a scenario sets `FOCUS_SWEEP_INTERVAL_SECS`
  (60 at least) to see them, and it looks at every linked
  inbox once a minute and backfills those whose owner, or a user they are
  linked to, has the flag, so a
  scenario longer than a minute may see a thread classified by that too.
  Events of other scenarios name threads that are not in this scenario's
  database and are passed over.
- A Redis database whose lease ran out is not handed out while any client
  is still connected to it: the services of a scenario that stalled would
  write into the next one's state. A former writer that is not connected at
  that moment is not seen.
- A session connected to a template database blocks every clone of it;
  the harness waits up to a minute for it and closes templates to
  connections.
- Many stacks at once can run the machine out of local ports: the
  connections of a stack that ended keep theirs for a minute, and CI's
  runners cannot widen the range (`/proc/sys` is read-only in their
  containers). Bind the harness's listeners, the emulators' included
  (`start_with_listener`), through `host::local_listener`, and pick a
  service's port with `host::free_port`; both wait for a port when none is
  left. Release the `ReservedPort` only when the service starts: a listener
  that took the port it sends to would send every request back to itself,
  opening a connection a turn until the machine runs out of ports and
  files. A service that finds its port taken is started again on another
  (`PORT_ATTEMPTS`).
- The stack server raises its open-file limit to 65536 at startup and stops
  when the system allows less. A stack that fails to start reports the open
  files, TCP sockets and port range the machine had left.

## Related

- Docs: `crates/gmail_emulator/AGENTS.md`, `crates/outlook_emulator/AGENTS.md`,
  `services/email_service/AGENTS.md`
