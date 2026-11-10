# Email HTTP parity lab

The test-only lab builds `ApiContext` through production composition and drives
`api::app` with Tower requests. Postgres and Redis are real; Gmail, SQS, service
HTTP calls, and the real Kafka publisher's broker are in process.

Each named step records the request and response (status, every response
header with only per-request values masked, body), final INFO-and-above tracing span fields and
INFO/WARN/ERROR events, SQL statements and execution counts, provider HTTP, SQS,
Kafka records, Redis changes, and changes in every public Postgres table. Database
snapshots use a separate pool so fixture and inspection queries do not enter the
SQL transcript. Kafka work drains through the production `TaskTracker`, then the
consumer reads up to the broker watermark. No timer or polling establishes step
completion.
SQS records include the response JSON, so partial batch success identifies both
the queued entry and the failed entry.

Run inside the repository Nix shell, exporting the private database and Redis
URLs inside that shell (Nix overrides `DATABASE_URL`). The production Kafka
publisher receives an explicit local transport environment. Keep `SQLX_OFFLINE` unset for
tests and run nextest with `-j 8`. Parity requires nextest's process-per-test
isolation (`NEXTEST`); plain `cargo test` returns from each parity test before
installing tracing or starting a lab and prints
`parity: skipped, run with cargo nextest (process per test)`.
Keep `TMPDIR` in the task's cache directory.

- `INSTA_UPDATE=always` records insta snapshots under `golden/<suite>/<name>.snap`.
  Review changes with `cargo insta review` where available, or inspect the diff.
  `INSTA_UPDATE=no` compares without writing; CI uses this behavior by default.
  Local mismatches may create `.snap.new` files; review or remove them before the
  orphan check can pass. Insta removes the terminal blank line from snapshots;
  the raw `PARITY_OUT` transcript keeps its original bytes.
- Each distinct SQL statement lives in `golden/<suite>/sql/<hash>.sql`, with the
  first twelve SHA-256 hex digits of its exact, whitespace-normalized contents
  (one line plus a final newline) as its hash. Steps list executions in order,
  one hash and its affected/returned row counts per line. Updates publish complete
  statement files atomically without overwriting existing content; comparison
  runs assert the contents and reject unreferenced or missing statement files.
  Orphan SQL validation runs after snapshot generation, because
  concurrent writers refresh scenario references independently.
- `PARITY_OUT=/path` also writes each transcript there, plus a
  `<scenario>.callsites.txt` sidecar. The sidecar lists distinct sorted
  `(kind, target, name-or-message)` triples per step. Module paths are excluded
  from goldens so moving code between modules does not change behavior goldens.
  Sidecars also count explicitly excluded timing-threshold events; those counts
  may differ between runs while the behavior transcript stays identical.
  Referenced SQL files are also copied under `<suite>/sql/` in that directory.
- `<scenario>.debug-spans.txt` contains the full span tree, including DEBUG and
  TRACE spans. Children of omitted spans attach to the nearest retained ancestor
  in the golden tree; log ancestry also lists only retained spans.
- Insta reports snapshot mismatches with its diff. Comparison runs never create
  or update SQL statement files in the golden directory.

Add a scenario as a `#[sqlx::test]` under `suites/`, returning immediately when
`process_per_test()` is false, setting `LabOptions.suite`, and reserving three
unique fixture shards for each run. Use `Lab::request` with an
empty, JSON, or raw body; the method, full path/query, body format, content type,
and body are recorded. The label suite owns its `labels` convenience method.
Finish the transcript and run each write form separately. The fixture has
three users, two inboxes owned by A, an inbox owned by B and delegated to A, and
an unrelated user C. The `message_reads` and `internal_reads` suites add opt-in
rich message content without changing the label fixture. They cover all nine legacy message/thread
read routes, query-stage failures, authorization, malformed requests, and both
pagination contracts. Internal requests can also send just a key, a wrong key,
an identity without a key, or no credentials.

Goldens preserve the current handler's behavior, including
its different inbox and message lookup scopes. The orphan check requires every
snapshot to have a corresponding scenario function and every scenario to have a
snapshot; pending `.snap.new` files fail the check too.

The source line number inside a Postgres error's debug text is masked in telemetry
(it differs between server versions; CI runs Postgres 14); the file and routine stay.
Known IDs have symbolic names; other UUIDs are numbered in first-appearance
order. Timestamps and endpoints are normalized throughout. Request IDs, durations,
and ports are masked only in telemetry; SQS has a separate receipt-handle list.
Application response bodies, provider bodies, Kafka payloads and table rows retain
fields named `duration`, `elapsed`, `port`, or `ReceiptHandle` unchanged.
SQL whitespace is collapsed but SQL text, row counts, statuses, label names,
span names, and field names are retained. Concurrent Kafka sibling spans are
ordered canonically; request and SQL execution order are retained.
Changed database rows contain their primary key and only changed columns, each
with before/after values. A changed timestamp keeps an explicit `<ts:changed>`
after value even when both real timestamps normalize to `<ts>`. Added and removed
rows remain complete.

The lab does not set process environment variables. Config, service URLs, AWS
credentials/endpoints, the read-receipt pixel URL, and Kafka transport are explicit,
so `ENVIRONMENT` (unset/local/dev/prod), `LOCAL_AWS_URL`, and service URL overrides
do not select dependencies. Error backtraces are stripped while keeping enclosing
Debug enum delimiters, so `RUST_BACKTRACE` does not change transcripts. Only `DATABASE_URL`, `REDIS_URI`, `INSTA_UPDATE`, and
`PARITY_OUT` configure a run; `NEXTEST` is the required runner marker. The label requests have no Origin header, so the
production CORS origin predicate does not consult ambient allowed origins.

Each scenario holds a test database and two Postgres connections while it runs, so
`.config/nextest.toml` puts the suite in the `email-parity` test group (at most
eight scenarios at once) whatever the runner's thread count.

## Cannot observe / not isolated

- Not characterized: DEBUG/TRACE spans. Production's default exporter retains
  INFO and above; dependency-internal spans are available only in the debug sidecar.
- Credential extraction is owned by `macro_auth` and runs before any
  `email_service` handler. Its ambient-environment-dependent cookie lookup logging
  is not characterized. Lab startup sends a no-credentials request and asserts
  its exact 401 status and JSON body outside capture; this also initializes that
  lazy lookup before internal requests. A plain assertion test pins the same
  response. The golden unauthenticated request sends an invalid Bearer JWT.
- Outlook Graph and Google Calendar clients have fixed public endpoints in their
  owning crates. The lab constructs them exactly as production does. Scenarios
  must not call them; provider credentials are rejected by the recording auth
  stub, making an accidental credential request visible. They are not isolated
  provider implementations and this suite does not characterize their APIs.
- The label suite exercises HTTP label writes, not delivery by background queue
  workers. Queued provider writes are recorded but not executed automatically.
- The AWS SDK retry policy is configured in `macro_aws_config`/the SDK and is not
  part of `email_service` code or characterized here; the lab disables SQS retries
  and records one attempt per injected failure.
- Redis capture is scoped to fixture-owned keys so parallel scenarios cannot
  record one another's activity; it does not observe unrelated shared keys.
- External process logs, native librdkafka diagnostics, filesystem effects, and
  tables outside the Postgres public schema are outside the transcript.
- Unscoped process monitors, including Tower's runtime starvation detector, are
  not request work. Events belong to a step through its request task or a captured
  span; the cancellation shield's detached handler span is captured as a root.
  The active runtime ID keeps unrelated runtime work out of the recording.
  Parity owns a global subscriber because the cancellation shield does not
  propagate a scoped subscriber. Its installation can perturb other tests'
  scoped tracing, so parity runs only under nextest, never in a shared libtest
  process. Existing tests keep their own tracing setup unchanged.
- Not characterized: wall-clock thresholds. Only the exact `macro_tower_layers`
  messages `slow http request` and `tokio runtime starvation detected` are dropped
  from goldens. Each is counted per step in the `PARITY_OUT` sidecar, including
  zero counts. Other warnings from the same target remain in the transcript.
The label suite injects failures in inbox resolution, label lookup, message lookup,
transaction begin, the transaction body, deferred commit, and rollback of an
unqueued write. The begin fault closes the service pool on its fourth acquisition,
after its three reads; the fixture/dump pool stays usable.
Rollback failure is deterministic too: a trigger terminates only its own
statement's backend, and the real transaction body and rollback both fail.
Additional cases cover undo of UNREAD/STARRED during outages, partial SQS batch
failure, older pending writes, malformed JSON/UUIDs, and ten provider messages.

## Read-route contracts

The read suites intentionally preserve these legacy differences:

- Single-message GETs return no bodies; batch and thread reads derive
  `body_parsed` from sanitized HTML or text. `ParsedMessage` omits attachments,
  reply IDs, snippets, and several other stored fields, but keeps draft generation.
- Public reads allow the union of owned and delegated inboxes. Unknown messages
  return 404; inaccessible messages and empty thread pages return 401. A mixed
  batch returns its accessible subset with a warning; an empty batch returns 404.
- Internal message/thread reads require an internal key and do not scope results
  to an acting user. An empty internal batch or thread page succeeds.
- Sender/history summaries pick the newest owned inbox, ignoring other owned
  inboxes and delegations. Their request's user ID selects the inbox.
- Public thread pagination uses `offset` and `limit`, rejects invalid bounds,
  defaults to five messages, and caps the limit at 100. Internal pagination uses
  `message_offset` and `message_limit`, replacing invalid bounds with defaults.
  Both order newest first with null dates last and exclude discarded drafts.
  Neither implements a cursor or `since` filter.

`read_fixture` keeps distinct timestamps and more than five thread messages so
pagination defaults, ordering, boundaries, and null dates remain observable.
Read suites sort response object keys, including HashMap keys, while retaining
the array ordering that queries define. This normalization is opt-in; label
goldens keep their original format.

Fault scenarios independently fail the message, sender, recipient, label, and
inbox queries; the summaries and owner routes also have their own query faults.

## Order not defined by the query (canonicalized)

Only `message_reads` and `internal_reads` declare these named `ResponseArrayRule`s.
They apply to the exact JSON paths below within the response section, before UUID
and timestamp normalization. Other sections and other arrays retain their order.
Paths start at the response object, so `$.body` is the decoded response body.

| JSON path | Rule and stable key | Query |
| --- | --- | --- |
| `$.body.labels`, `$.body[*].labels` | `MessageLabelsByProviderId`: `provider_id`, then `name` | `crates/email_db_client/src/labels/get.rs:113` orders only by message ID, not labels within a message. |
| `$.body.to`, `$.body.cc`, `$.body.bcc`, `$.body[*].to`, `$.body[*].cc`, `$.body[*].bcc` | `MessageRecipientsByAddress`: `email`, `name`, then `photo_url` | `crates/email_db_client/src/contacts/get.rs:298` orders by message ID and recipient role, not recipients within a role. |
| `$.body` on POST `/email/messages/batch` and `/internal/messages/batch` | `BatchMessagesById`: `db_id` | `crates/email_db_client/src/messages/get_parsed.rs:154` has no `ORDER BY`. |
| `$.body` on GET `/email/threads/{id}/messages` and `/internal/threads/{id}/messages` | `ThreadTimestampTiesById`: `db_id` only within adjacent equal `internal_date_ts` groups | `crates/email_db_client/src/messages/get_parsed.rs:270` defines descending timestamps, nulls last, but no tie breaker. Primary order is preserved; pagination fixtures use distinct timestamps to avoid ambiguous page membership. |

The sender query (`messages/get.rs:54`) and history query (`user_history.rs:68`)
produce JSON objects, whose keys are already sorted by the read suites. Sender
contact queries (`contacts/get.rs:408`) populate lookup maps, not output arrays.
The history query's scalar selections order by timestamp (`user_history.rs:90`,
`:132`, `:147`); fixtures give competing messages distinct timestamps. Inbox
selection orders by `created_at` (`links/get.rs:61`, `:153`); fixtures give inboxes
distinct creation times. Thread-owner lookup returns one uniquely identified
thread. These routes use the attachmentless mapper and never query attachments;
seeded attachments deliberately have no response array.
