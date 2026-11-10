# Email HTTP parity lab

The test-only lab builds `ApiContext` through production composition and drives
`api::app` with Tower requests. Postgres and Redis are real; Gmail, SQS, service
HTTP calls, and the real Kafka publisher's broker are in process.

Each named step records the request and response, final INFO-and-above tracing span fields and
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

- `PARITY_UPDATE=1` rewrites checked-in goldens under `golden/<suite>/<name>.txt`.
- Each distinct SQL statement lives in `golden/<suite>/sql/<hash>.sql`, with the
  first twelve SHA-256 hex digits of its exact, whitespace-normalized contents
  (one line plus a final newline) as its hash. Steps list executions in order,
  one hash and its affected/returned row counts per line. Updates publish complete
  statement files atomically without overwriting existing content; comparison
  runs assert the contents and reject unreferenced or missing statement files.
  Orphan SQL validation runs after generation, outside `PARITY_UPDATE`, because
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
- Without `PARITY_UPDATE=1`, a mismatch fails with a unified diff.

Add a scenario as a `#[sqlx::test]` under `suites/`, returning immediately when
`process_per_test()` is false, setting `LabOptions.suite`, and reserving three
unique fixture shards for each run. Use `Lab::request` with an
empty, JSON, or raw body; the method, full path/query, body format, content type,
and body are recorded. The label suite owns its `labels` convenience method.
Finish the transcript and run each write form separately. The fixture has
three users, two inboxes owned by A, an inbox owned by B and delegated to A, and
an unrelated user C. Goldens preserve the current handler's behavior, including
its different inbox and message lookup scopes. The orphan check requires every
golden to have a corresponding scenario function.

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
do not select dependencies. Error backtraces are stripped, so `RUST_BACKTRACE`
does not change transcripts. Only `DATABASE_URL`, `REDIS_URI`, `PARITY_UPDATE`, and
`PARITY_OUT` configure a run; `NEXTEST` is the required runner marker. The label requests have no Origin header, so the
production CORS origin predicate does not consult ambient allowed origins.

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
- This suite exercises HTTP label writes, not delivery by background queue
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
The suite injects failures in inbox resolution, label lookup, message lookup,
transaction begin, the transaction body, deferred commit, and rollback of an
unqueued write. The begin fault closes the service pool on its fourth acquisition,
after its three reads; the fixture/dump pool stays usable.
Rollback failure is deterministic too: a trigger terminates only its own
statement's backend, and the real transaction body and rollback both fail.
Additional cases cover undo of UNREAD/STARRED during outages, partial SQS batch
failure, older pending writes, malformed JSON/UUIDs, and ten provider messages.
