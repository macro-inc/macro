# Scheduled actions and event routines

This service runs user-owned cron and event-triggered routines through the same
agent/tool runner. Event support is backend-only; there is no event-filter editor.

## Configuration and release actions

`EVENT_ROUTINES_ENABLED` is a typed boolean loaded by `macro_config`, defaulting to
`false`. The same value gates event creation/configuration/enabling, Kafka intake,
and pending dispatch. Disabled startup launches neither event consumer nor worker.
Cron, owner-scoped reads/history, deletion, disabling, and explicit manual execution
remain available. Manual execution has no triggering event and does not replay or
clear an event's deduplication record.

Operators must register `EVENT_ROUTINES_ENABLED=false` as a **raw non-secret value**
in the agent-schedule-service Doppler dev/prod configurations before rollout, run
configuration validation, and explicitly enable it as a separate release action.
Builders do not mutate Doppler or deployed infrastructure. Configuration is loaded
at startup: changing the value requires redeploying **all replicas**.

Reuse `KAFKA_BROKERS`, `DATABASE_URL`, and the existing tool-service dependencies.
The durable group is `scheduled-action-event-ingestion`; it subscribes only to the
existing document and channel topics. Kafka chooses local plaintext versus remote
MSK IAM through the existing adapter. No new topic, SQS queue, or service is needed.
[`infra/stacks/agent-schedule-service/service.ts`](../../infra/stacks/agent-schedule-service/service.ts)
already grants Kafka client access and scales to multiple replicas (up to three
in production, two in dev). PostgreSQL claims and deduplication coordinate replicas;
process-local exclusion is not relied upon.

### Rollout

1. Apply the additive trigger and event-run migrations before service deployment.
   Legacy cron inserts remain valid.
2. Deploy trigger-aware binaries and compatible clients everywhere with the gate
   off. Confirm health and ordinary cron/manual execution. Do not create event-only
   rows while any old binary remains: old readers assume non-null cron columns.
3. Enable the gate on all replicas. Verify consumer group assignments, successful
   admissions/commits, worker progress, authorization denials, and queue age/count.
   Exercise a human-origin event, a bot-origin exclusion, and permission revocation.
4. Watch consumer restarts/Kafka lag, pending queue growth, interrupted/failed runs,
   claim age, database latency/pool contention, and model/tool capacity before
   expanding usage. An HTTP health response alone does not prove intake is healthy.

### Pause and rollback

Turn the gate off on all replicas to stop intake and dispatch; it does **not** erase
pending runs, disable stored actions, or cancel work in other still-enabled replicas.
Disabling an individual action cancels its queued work when maintenance resumes.
Re-enabling that action advances its revision and activation boundary.

Prefer rolling back to a trigger-aware binary with the gate off. Do not roll back
to a cron-only binary while event-only rows exist, and do not reverse migrations
under running services. Any removal/conversion of event actions is an explicit,
owner-aware operator action with data-loss implications, not automatic rollback.
Never reset consumer offsets or change group identity as a recovery shortcut.

A global gate pause does not reset activation boundaries: eligible retained events
and still-current pending runs can execute on resumption. Events no longer retained
by Kafka cannot be recovered. For a fresh activation rather than catch-up, disable
and re-enable the individual action. Coordinate this with owners.

## API and matching

Existing `/scheduled-actions` routes accept canonical tagged triggers:
`cron { schedule, timezone }` or `events { filters }`. Legacy cron bodies remain
accepted; mixed legacy/tagged inputs are rejected. Lists are cron-only unless
`include_events=true`. Event responses omit legacy cron schedule fields rather than
inventing a placeholder schedule. Ownership and server-maintained claim/revision
fields cannot be supplied by clients.

Filters are ORed; event name and entity ID must match within the same filter.
Missing/null `ids` means unrestricted IDs; `ids: []` matches nothing. Limits are
32 filters, seven event names per filter, and 100 IDs per filter. There are no
wildcards, regexes, content predicates, arbitrary topics, or workspace expansion.
Selectors are not permission grants. The owner's current document `ViewAccessLevel`
or channel `ViewOnly` access is checked both at admission and before claim.
Unavailability is not treated as permission denial.

Allowlisted event names and required attribution:

| Event | Attribution |
| --- | --- |
| `document.created` | Explicit human user actor; never infer from ownership |
| `document.updated` | Human actor, or legacy `actor_user_id` without delegated attribution |
| `channel.created` | Human actor, without delegation |
| `channel.message_posted` | Human sender, without agent/delegated indicators |
| `channel.mentioned` | Human sender |
| `channel.message_patched` | Human mutation actor |
| `channel.message_attachment_created` | Human mutation actor |

Bot/delegated/ambiguous events are non-triggering. In particular, `document.copied`
ownership is not execution attribution. Content/interaction events, channel rename
and participant changes, deletions/removals, webhook events, agent triggers, and
agent-session lifecycle events are excluded. Some agent tools use human receipts;
these exclusions are necessary for loop prevention. Agent runs retain bot tool-write
attribution. Adding an event requires reviewing producer attribution, not just
extending a string allowlist.

## Delivery, revisions, and retention

- Intake is at least once. Commit follows durable admission or explicit permanent
  rejection, never model completion. Transient admission errors get five attempts
  with 1/2/4/8-second delays. Exhaustion, receive errors, or commit failures drop the
  consumer; the supervisor creates a fresh consumer after five seconds, restoring
  committed offsets. Partial admission is safe to redeliver. Shutdown also leaves
  unfinished admission uncommitted. Raw event payloads are not logged.
- One run per `(action_id, event_id)` survives duplicate delivery and overlapping
  filters. Keep compact terminal/dedup records until action deletion; **no automatic
  expiry** exists. Growth is intentional until a replay/retention policy is agreed.
- No pre-activation backfill: the validated UUIDv7 event timestamp must meet the
  persisted activation boundary. Unsupported identities/schemas are rejected.
- Runs queue while an action is busy and execute sequentially per action, in DB
  admission order. There is no total ordering across Kafka partitions/topics.
  Queue length is not capped: sustained arrival above execution throughput grows
  PostgreSQL storage and latency. Disabling intake transfers backlog growth to
  Kafka lag and its finite retention; it is not a lossless indefinite pause.
- Every configuration update advances a dedicated revision, independent of
  `updated_at`. Superseded/disabled queued work is cancelled. Trigger changes and
  enabling establish a new activation boundary. Replacement during an active run
  is rejected; disabling remains allowed and does not undo committed side effects.
- A fenced claim durably changes pending to started **before** execution. There is
  **no automatic execution retry**, including failure, timeout, interruption, or a
  crash after claim but before any model invocation. This can intentionally lose an
  attempt rather than duplicate side effects. Bookkeeping recovery never re-runs
  the agent. Later pending events remain eligible after claim release/expiry.
- Only minimal normalized event context is queued and passed as data, separate from
  the routine prompt. Do not store raw broker envelopes or channel content here.

## Capacity and shutdown

Per replica, intake is serial with candidate pages of 100; one worker polls every
second and admits at most **two concurrent event executions**. It awaits bounded
futures rather than spawning an unbounded task per event. The shared PostgreSQL
pool remains 3–10 connections. Two event execution slots leave headroom for HTTP,
cron, and existing tool services; this is not a hard CPU or per-tool DB-connection
reservation. Monitor contention before increasing concurrency. Per-action fencing
also covers cron/manual claims. Agent lifetime is bounded by the 20-minute claim.

Consumers, workers (including cron dispatch), executions, and tool-event publishers
have separate trackers. Event dispatch futures are tracked but remain owned/awaited
by the worker. On SIGTERM/SIGINT or server failure:

1. Stop HTTP acceptance, consumer intake, and new worker claims; then signal agent
   cancellation, including cooperative tool cancellation. A claim already in flight
   may commit, but its executor sees cancellation instead of starting model work.
2. Await consumers/workers and execution bookkeeping, then drain their final event
   publishes. HTTP graceful shutdown proceeds concurrently.
3. Use **one eight-second deadline** for all of this, not successive per-component
   timeouts. Log remaining task counts on expiry and exit. The existing ECS
   container `stopTimeout: 10` supplies the final hard stop; synchronous external
   calls or non-cooperative tools may still require that stop.

Unresolved started event rows remain non-retryable. Once their claim deadlines
expire, enabled-worker reconciliation marks them interrupted and releases fenced
claims. If the gate stays off, reconciliation waits too. In-flight side effects
cannot be undone by cancellation; never put interrupted work back into pending.

## Verification

From the repository root, with local PostgreSQL and `SQLX_OFFLINE` unset:

```sh
env -u SQLX_OFFLINE cargo test -p scheduled_action --test event_routines
env -u SQLX_OFFLINE cargo test -p scheduled_action
nix develop --command just prepare_db
nix develop --command just check
nix develop --command just check full
```

Service tests cover gated spawning, fresh-consumer supervision, bounded shutdown
(including stalled HTTP), server failure, and execution-before-publisher drain.
Worker/domain tests cover bounded concurrency, pre-claim shutdown, access policy,
and terminal no-retry behavior. Live Kafka/IAM and multi-replica rollout checks
remain operator verification; unit tests do not establish production connectivity.

### PostgreSQL integration regressions

[`tests/event_routines.rs`](tests/event_routines.rs) wires the real Axum router,
management/admission/dispatch services, both PostgreSQL repositories, event worker,
and shared `InProcessExecutor`. Only authentication, current-owner access, live
updates, and the agent-run port are fakes. SQLx creates an isolated migrated database
per test; use a local test role allowed to create databases, never hosted data.
No model credentials are needed and no model calls are made.

The six tests cover:

- Legacy cron and canonical event CRUD through one API, list compatibility, manual
  execution without event context, chat-linked history, and deletion.
- Two worker replicas sharing PostgreSQL, two arrivals during an active run, FIFO
  continuation after failure, and duplicate delivery while pending/started/finished.
- Overlapping filters, two routines matching one event, concurrent duplicate intake,
  one-item candidate pages, and competing dispatches of the same pending snapshot.
- Dropped admission while its transaction is blocked before commit; fresh intake
  after durable admission but before a simulated offset acknowledgment.
- Committed start without invoking the runner; simulated output side effects without
  finalization; deadline reconciliation to interrupted; terminal redelivery and stale
  dispatch. Interrupted attempts never run again, but later queued events complete.
- A human channel event followed by simulated bot-authored document/channel outputs:
  repeated output delivery creates no further event-run rows, even with human owner
  and legacy actor metadata.

These are durable-boundary simulations, **not** process-kill, broker-offset, live
permission-service, Kafka/MSK IAM, tool-producer attribution, or LLM verification.
Existing Kafka adapter tests exercise the receive/admit/commit loop with fake
transport separately. Worker replicas here are independent tasks/adapters in one
process, not separate deployed services.

### Verified local procedure and remaining checks

The database-only procedure above passed using the existing migrated loopback
PostgreSQL and the builder's inspected `macro-build-env --local-db` toolchain wrapper:
all six integration tests and all **137 scheduled-action tests** passed with
`SQLX_OFFLINE` unset. Root `cargo fmt --check` and the changed-file AST rules passed;
focused integration Clippy completed without findings in the new test file.
All five test SQL statements reuse existing checked queries/cache entries; no schema
or generated SQLx metadata changes are required.

Environmental/check limitations recorded during this verification:

- Nix is not installed, so all three Nix commands above were unavailable.
- The equivalent root `just sqlx::prepare_db "$DATABASE_URL" --tests` reached the
  workspace build but failed in `rs-libreoffice-bindings`: Clang could not find
  `stddef.h`. Its incomplete cache deletion was reverted, not committed.
- Direct `just check` / `just check full` could not discover changes in the isolated
  JJ workspace and skipped checking. Their exit status is **not** a passing gate.
- Strict package Clippy (`--tests -- -D warnings -D clippy::disallowed_methods`)
  reports pre-existing `needless_return` in `inprocess_executor.rs` and non-macro
  queries in `pg_scheduled_action_repo/test.rs`; these are outside this test-only task.
- `just doctor-local` failed: Docker daemon unreachable, `cargo-zigbuild` and
  `sccache` unavailable; it also reported occupied local ports. No full local stack
  was started, no databases/volumes were reset, and no live Kafka/MSK or LLM run
  was verified.

For the remaining live smoke test, follow [Running locally](../../docs/RUNNING_LOCALLY.md)
first: obtain a passing `just doctor-local`, then start a disposable named stack with
`just run_local --no-doppler --instance routines-smoke --env-file ./local.env`.
Keep the env file untracked; explicitly enable `EVENT_ROUTINES_ENABLED` and supply
approved model credentials only if intentionally testing real agent/tool execution.
The default integration stubs do not establish a working model connection.

Using local authenticated owners and the existing API/OpenAPI, create a legacy cron
routine and an event routine selecting a local document/channel. Produce a human
edit/message after activation, then two more while execution is active. Observe one
row per event/action, sequential execution, history/chat linkage, and continued cron
behavior. Repeat with bot tool output and permission revocation: expect no loop and
no unauthorized execution. With two service replicas, observe group assignment,
committed offsets, and exclusive per-action claims; terminate a replica around the
listed durable boundaries and verify interrupted work is not replayed while later
work drains. Do not reset offsets, requeue terminal rows, or claim this live procedure
passed based on the database-only tests.
