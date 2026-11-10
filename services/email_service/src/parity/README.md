# Email parity lab

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
`PARITY_OUT` configure a run; `NEXTEST` is the required runner marker. The two
provider-global suites additionally require nextest's `NEXTEST_TEST_GROUP` and
`NEXTEST_TEST_GROUP_SLOT` assignments. The label requests have no Origin header, so the
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
- The label suite exercises HTTP label writes. Queued provider writes are recorded
  but not executed automatically; `gmail_ops_worker` explicitly delivers them.
- The AWS SDK retry policy is configured in `macro_aws_config`/the SDK and is not
  part of `email_service` code or characterized here; the lab disables SQS retries
  and records one attempt per injected failure.
- Redis capture in the original suites is scoped to fixture-owned keys. The
  provider-global suites below capture their entire isolated logical database.
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

`message_reads`, `internal_reads`, and `inbox_routes` declare these named `ResponseArrayRule`s.
They apply to the exact JSON paths below within the response section, before UUID
and timestamp normalization. Other sections and other arrays retain their order.
Paths start at the response object, so `$.body` is the decoded response body.

| JSON path | Rule and stable key | Query |
| --- | --- | --- |
| `$.body.messages[*].labels`, `$.body.messages[*].{to,cc,bcc}` on GET `/email/drafts/scheduled` | `ScheduledMessageFields`: labels by provider ID/name, recipients by address/name/photo | The scheduled mapper uses the same bulk label and recipient queries as message reads. The surrounding messages stay in SQL `created_at DESC` order. |
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


## Inbox and backfill routes

`inbox_routes` characterizes calendar disconnect, contact listing, scheduled draft
listing, settings patches, and Gmail signature import. `backfill_api` characterizes
public job listing/get/active/cancel and internal job create/get/cancel. Each suite
owns its fixture extensions; neither changes the original label/read fixtures.
Both add an Outlook inbox. Inbox creation times, scheduled message creation times,
and job creation times are distinct so ordered queries never depend on ties.
Response-visible fixture timestamps are fixed, including update and attachment
timestamps: variable fractional precision would otherwise change the real
Content-Length header even though normalized JSON bodies matched.
Contact arrays retain their defined interaction-time/address order. Backfill
creation pairs retain request order, including repeated links.
Scheduled provider, draft and forwarded attachments retain their queries'
filename order; the fixture uses distinct filenames so ties are not pinned.

`Lab::request_with_headers` records all values of supplied headers, including
repeated and invalid UTF-8 values. The original `request` omits this section, so
existing transcripts retain their bytes. Raw stub replies supply actual image
bytes; FakeGmail scripts send-as status/body or aborts that response connection.
Only signature scenarios explicitly enable the local Google credential reply.
SFS failure tests use one remote source at a time to avoid assigning an order to
independent concurrent image fetches. The multiple-unresolved case uses distinct
URL fragments that produce identical HTTP requests after fragment removal.
It opts into `sort_sfs_source_sets` for the `fetch_sfs_mappings` span's `sources`
field: that field is Rust Debug output from a HashSet, so its URLs are retained
and sorted. Other spans, response content, and existing suites are unchanged.
Opt-in streamed replies cover advertised and streamed size limits, broken bodies,
redirect loops, and the production request timeout without sleeps. Bound sockets
that never listen exercise connection refusal without a port-reuse race.

Calendar refresh tasks are detached by production code. Calendar success
scenarios opt into `drain_background`, which waits for the last captured request-span
owner through a notification before closing the step. Other suites retain their
original step boundary. `SqlFault::pause_acquisition` provides an acquisition
barrier for a real concurrent deletion between calendar authorization and the
transaction; fixture SQL runs outside the request capture.

The suites preserve these legacy behaviors:

- Link middleware accepts explicit delegated inboxes; absent headers select only
  the caller's own primary inbox. A delegate cannot disconnect a calendar. Key-only
  internal calls use the configured internal identity: collection reads return
  empty results, inbox-scoped routes report no selected inbox, and calendar
  deletion is forbidden.
- Contacts include owned and delegated inboxes, with entries only for recipients
  of sent messages. Calendar-free inbox disconnects still persist the opt-out.
- Signature import prefers the inbox address case-insensitively, then the primary
  alias; an own alias with an empty signature does not fall back. Image fetch or
  SFS upload failures reject the whole patch/import, while mapping-query errors
  permit saving the sanitized original signature. An HTTP-looking relative image
  path is counted as unresolved, while ordinary relative paths are ignored.
  Source URLs longer than 2,000 characters are rehosted but never cached.
- Job listing uses the caller's fusion ID across owned and deleted inboxes;
  delegated jobs require the inbox-scoped get/active routes. Cancellation rejects
  every terminal state. Internal creation reuses active jobs without enqueueing,
  accepts negative thread limits and Outlook links, and retains earlier work
  after a later link fails. Queue failure marks the newly inserted job failed.

Some branches are unavailable over this HTTP surface:

- The link middleware's unknown-provider arm is behind a typed PostgreSQL provider
  decoder; invalid enum values fail before that arm. `InboxActionError::Conflict`
  and its lifecycle conversions belong to other link routes, not calendar removal.
- Coverage marks the first argument of the public backfill get/cancel
  missing-job WARN as unexecuted in tracing's fallback to `log`. That fallback
  is disabled after the lab installs its required subscriber; the tracing WARN
  itself, including both IDs, is present in the goldens.
- Closing a Google watch channel with valid credentials calls Google's fixed
  public endpoint. Calendar watch scenarios use a deliberately uncached identity
  and reject credentials locally; they cover the token-failure path and never
  call that endpoint. Outlook calendar removal itself has no Graph call.
- The image helper's `srcset` paths cannot be reached from settings/import: their
  mandatory sanitizer removes `srcset`. It also removes unsupported schemes.
  The literal selector and valid UTF-8 rewriter setup cannot be made invalid by
  an HTTP request. The `sfs_map`-disabled branch is absent in the default-feature
  test build.

## Inbox initialization and Gmail ingress

`inbox_init` drives `POST /email/init`, including Gmail grants, Outlook grant
adoption, entitlement checks, reconnects, delegated inboxes, shared promotion,
calendar permission upgrades, and backfill publication. Its fixture alone gives
FusionAuth identities valid UUIDs. `gmail_ingress` drives the public Google push
webhook and the internal delete-user route. The default Cargo features include
`gmail_webhook_auth`, so these goldens characterize the verified-token branch.
JWTs are signed in process with `jsonwebtoken` and the local-only identity key
already included by the lab from `tooling/xtask`. `Jwk::from_encoding_key` derives
public n/e values; no new key material, executable or temporary file is needed.
Distinct kids exercise cache misses, while a modified public modulus exercises
same-kid signature mismatch and refresh. The recording stub serves those JWKS.
Fresh expiry claims use the current clock because the production verifier checks
real time; the complete JWT is normalized before recording.

These two suites connect only through `REDIS_URI`, replacing its database path
with `1 + NEXTEST_TEST_GROUP_SLOT`, and `FLUSHDB` that logical database before
setup. Missing, nonnumeric or out-of-range slots fail clearly; the helper also
requires `NEXTEST_TEST_GROUP=email-parity`. With `max-threads = 8`, indexes 1–8
are reserved for these tests. [Nextest guarantees](https://nexte.st/docs/glossary/#slot-numbers)
that group slots are unique for each running test's entire lifetime, and reuses
a slot only after its test ends. Thus concurrent scenarios never share a database,
even under `-j 32`; separate nextest invocations must not run against the same
server concurrently. Original suites still use database 0 and fixture-scoped keys.
The explicit database URI reaches all clients, including token caches and Gmail
admission, and the new suites capture all Redis keys in that database.

The admission and cache-write fault scenarios create a slot-named ACL user with
fresh credentials. Only the scenario's service connections authenticate as that
user; the helper keeps its base connection for setup and cleanup. Denying `EVAL`
and `EVALSHA`, or `SETEX`, affects only that user. The tests never change the default
user, server memory limits or other global configuration. They remove the user
before checking the snapshot; a subsequent fault scenario resets the slot's user
if an earlier failed test left it behind. `REDIS_URI` must permit `SELECT`,
`FLUSHDB` and these test-user ACL operations, as the CI Redis service does.
`Lab::start_configured` keeps rollout flags explicit; the existing lab entry point
retains the original defaults.

The initialization suite opts into `normalize_gmail_redis_clock`. Gmail quota
window fields are wall-clock seconds: the transcript retains their total charged
units, while omitting the clock-dependent bucket names. Adaptive capacity retains
its cap and masks its `at` timestamp. Redis keys normalize their UUIDs through the
same identity map as other sections. This option is off for every existing suite.
Neither new suite has a response array requiring a `ResponseArrayRule`.
Scripted 429s include a 60-second `Retry-After` so their cooldown keys survive
transcript capture even on a loaded runner; snapshots record key values, not TTLs.

Initialization currently calls Gmail watch registration (and stops/retries a
conflicting watch). It does not call Gmail profile, label/history reads, People
API contact sync, SFS, or the connection gateway. Those operations happen later
in workers. FakeGmail supports profile/watch and optional endpoint reply sequences
without changing its label/history behavior. The service stub's optional reply
sequence can succeed for watch credentials, then deny token discovery.

The direct token-info request (`fetch_token_scopes` in
`src/outbound/inbox_connection/provider/token_scopes.rs`) cannot be redirected.
Scenarios reach its preceding branches using recorded grant generations, failed
grant lookups, and local token acquisition failures. They never call the fixed
Google URL. Consequently `fetch_token_scopes` and the discovery-success/error
handling after its call (`discover` in
`crates/email/src/domain/mailbox/connection/grants.rs`) remain outside this HTTP
lab; domain tests on a fake port cover each outcome. Calendar grants supplied by completed consent use the real database
service and its durable outbox; they do not contact Google Calendar or Graph.
Shared-mailbox promotion generates a customer-ID string containing its generated
UUID. Only `inbox_init` enables `normalize_embedded_uuids`, retaining the
`cus_shared_` prefix and the same symbolic UUID identity used elsewhere.

## Queue workers

Call `Lab::start_workers` to build contexts through each production
`pubsub::<worker>::worker::context` function. This is opt-in so HTTP scenarios
retain their startup and step boundaries. The lab reuses the label-write
simulation's Gmail/SQS clients and CRM wiring, and uses its own recorded Kafka
broker, service HTTP stub, private database, and private Redis. Backfill has the
production backfill Gmail rate budget. Fixed-endpoint Outlook adapters remain
subject to the provider restrictions above. The concrete CRM metadata resolver
also fixes `ReqwestUnfurlFetcher`, which cannot inject a local transport. Gmail
operation scenarios never invoke it. Future worker scenarios must seed CRM
directory entries or avoid metadata resolution until that adapter has a seam.

`Lab::worker_step` offers exactly one wire message to fake SQS, calls the real
`SQSWorker::receive_messages`, then calls the same `process_message` function as
the selected worker loop. Processing runs in its own Tokio task, as it does in
the simulation and production worker, so the recorder's future does not add
stack frames to the legacy reversion path. `delivery` and `outcome` replace `request` and
`response`; all other sections and sidecars are the same. Delivery includes the
queue, body (including malformed or absent bodies), identity, receipt handle,
receive count, system attributes, and message attributes. Outcome independently
records the returned `Ok`/`Err`, deletion, retention for redelivery, visibility
changes in seconds, and each send's destination, body, and requested delay.
`Ok` does not imply deletion: the Gmail retryable-error handler returns `Ok`
while leaving the message for redelivery.

`Delivery::redelivered` keeps the message identity/body/attributes and increments
its receive count; `Delivery::from_sent` consumes the actual recorded send body.
Scheduling is explicit and virtual: the lab never sleeps to make a message
visible. The suite records the last permitted receives (3 on the primary queue,
100 on the retry queue); SQS's subsequent redrive is external to the worker.
Keep worker scenarios in process; do not shell out to host tools or change Redis
server configuration. Worker labs reuse `suites::redis_database::RedisDatabase`
to select Redis logical database `1 + NEXTEST_TEST_GROUP_SLOT`, clear only that
database at startup, and capture
every key there, including provider-global keys. HTTP labs retain their existing
fixture-key scope.
Scripted worker 429 replies carry `Retry-After: 60` so the cooldown survives
capture. Worker steps opt into `GmailGateWindowTotalUnits`, matching only
`gmail:{<canonical UUID>}:window`: it replaces the per-second fields with their
sum in `<total_units>` and retains any other fields unchanged. This pins total
admitted units per window key, but does not pin the split of admissions across
wall-clock seconds. The rule is applied before diffing; moving the same units
between seconds alone is not a Redis change. Other Redis keys and HTTP suite
transcripts are unaffected by this rule. Learned-cap and lease timestamps are
masked separately; caps and members are retained.

Outside the step are the infinite receive loop, its batch error aggregation and
logging, cancellation, panic/restart supervision, and the link-manager loop's
visibility renewal wrapper. Backfill's per-message visibility heartbeat is
inside its process function. Long-running backfill admission waits and provider
timeouts are not characterized by this suite; their real-time waits are not
advanced by SQS's virtual scheduling. No production retry or timing behavior is
changed to accommodate tests.

The Gmail suite covers operation forms and batch boundaries, provider responses
and disconnections, local admission refusal, primary-to-retry sends, retained
deliveries, malformed bodies, missing links/receipts, SQS failures, marker turns,
mid-send turn changes, partial and whole-write reversion, duplicates, and query
and transaction failures. Fixtures and fault installation run outside capture.
