# email_e2e

## What it is

The end-to-end test suite for Email: the real `email_service` API and its
`pubsub_workers` (queue workers and the Outlook mailbox loops) run as
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
- Scenarios run in parallel and share nothing but the servers (Postgres,
  Redis, SQS, Kafka, and OpenSearch for search).
- The services are the binaries in `target/debug` (or `EMAIL_E2E_BIN_DIR`),
  started with an environment the harness builds (`src/stack/environment.rs`)
  and nothing else. Build them before running; `just email-e2e` does.
- Each scenario's service logs are in
  `target/debug/email-e2e/<test>-<id>/{email_service,pubsub_workers,document_storage_service,search_processing_service}.log`.
  A failing scenario prints the directory and the end of the logs.

## Writing a scenario

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
  `stack.dead_letters(queue)`), and the database (`stack.db()`) last.
- Wait with the `wait_for_*` methods or `eventually`; never sleep. A wait
  ends when its condition holds, so the 120 s limit only costs time on failure.
- To prove something does *not* happen, make a later event happen and wait
  for that (deliver a second mail, then assert the first has no duplicate).
- The scheduled-send cron: `stack.run_scheduled_sweep()` runs the real
  `email_scheduled_handler` once. Work of the other crons is enqueued by the
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
  email-e2e-known-bugs` (in CI a job that never fails for a scenario) runs only those and reports
  which still fail and which now pass. Remove the attribute with the fix.
- Sending the way the web composer does (a stack with `document_storage`):
  `inbox.send_attempt(attempt_id, &message, &extra)` with the GraphQL draft
  input (`draftId`, `subject`, `to`, `bodyText`, …), then `cancel_send`,
  `send_attempt_state` and `wait_for_send_attempt(attempt_id, "SENT")`. The
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
- Mail that must be in the mailbox before it is linked: `stack.seed_mailbox`.
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

## Start here

- `tests/gmail.rs`, `tests/outlook.rs`: one worked scenario per provider.
- `tests/journey_*.rs`: whole user journeys (compose, organise, read,
  account, sender rules, agent, provider parity, connect, follow-up),
  each for Gmail and Outlook where the product has both.
- `src/stack.rs`: `Stack`, what it starts and what a scenario can ask it.
- `src/inbox.rs`, `src/user.rs`: the scenario's vocabulary.

## Scope

- Owns: the harness and the email scenarios.
- Not here: the fakes of Google and Microsoft → `crates/gmail_emulator`,
  `crates/outlook_emulator`. Tests of one crate's logic → that crate.
- Not started yet: `calendar_service`, the real notification and
  authentication services, and the web app. `document_storage_service` is
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
- `just email-e2e` also builds `search_processing_service` and
  `document_storage_service`, whose build
  needs the repository's `bun install` or `CODE_MODE_ASSETS_DIR` pointing
  at `nix build .#code-mode-assets`.
- No ElasticMQ at hand: `docker run -p 9324:9324
  softwaremill/elasticmq-native:1.7.1`, then
  `EMAIL_E2E_SQS_URL=http://127.0.0.1:9324`.
- A new or changed scenario: `just email-e2e --stress-count 20 <name>` passes.
- CI: the `Email end-to-end` workflow (`xtask_workflows`' `email_e2e.rs`)
  runs the suite on pushes to `main` that change backend code and, within
  `PR CI`, on pull requests that touch email, the emulators or the schema.
  Its jobs run side by side: the scenarios without search in three parts
  (nextest `--partition`), the search scenarios with OpenSearch, and the
  scenarios for known bugs. A scenario outside `tests/search.rs` that sets
  `StackOptions::search` has no cluster in CI: keep search scenarios in that
  file.

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
  topics, which a stack that starts it creates when missing, and its
  consumers share their groups across scenarios: an event one scenario
  publishes may be read by another scenario's process, so do not assert on
  what that service does with Kafka events.
- One search indexer at a time: every indexer is in the consumer group
  `search-processing-service`, so two of them split the topics between
  them and each misses the other's share. The `email-e2e-search` test
  group in `.config/nextest.toml` runs `tests/search.rs` serially; a bare
  `cargo test` runs its tests in parallel and they fail.
- A session connected to a template database blocks every clone of it;
  the harness waits up to a minute for it and closes templates to
  connections.

## Related

- Docs: `crates/gmail_emulator/AGENTS.md`, `crates/outlook_emulator/AGENTS.md`,
  `services/email_service/AGENTS.md`
