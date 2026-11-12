# Channel sequence transaction and timeout audit

Static audit of the implementation against base `354da677b5`. Source locations
below identify the production transaction boundaries. The append statements
temporarily change their transaction-local statement timeout; no server or pool
configuration is changed.

## Counter lock and commit boundaries

`channel_change_db_utils::append_in` increments the counter and inserts the log
row in one statement (`crates/channel_change_db_utils/src/append.rs:48`). Its
row lock remains held until the caller's transaction ends. The batch equivalent
locks counters in channel-id order and allocates each channel's sequences in
input order (`crates/channel_change_db_utils/src/append.rs:98`). The new tables
have no foreign keys or triggers that acquire another domain's row lock
(`crates/macro_db_client/migrations/20261110150956_channel_change_log.sql:3`).

Each nonempty append now uses two SQL statements. A preflight saves the
inherited `statement_timeout` and sets the smaller nonzero value of that
timeout and 50 ms (`crates/channel_change_db_utils/src/append.rs:14`). This
extra round trip occurs before counter acquisition. The final statement
allocates sequences and log rows, consumes all inserted log rows, and restores
the saved setting. No round trip follows counter acquisition. The restoration
barriers are at `crates/channel_change_db_utils/src/append.rs:59` for a scalar
and `:121` for a batch. Empty or invalid-length activity batches return before
the preflight. Neither statement changes `lock_timeout`.

| Channel write | Work completed before counter acquisition | Append and commit | Work while holding the counter |
| --- | --- | --- | --- |
| Create root/reply | Canonical-root advisory lock when applicable, parent/root validation, insert, thread creation, references, and response hydration | `crates/messages/src/outbound/pg_message_repo.rs:753`, commit `:754` | Only COMMIT, including existing deferred constraints. |
| Edit | Message/thread `FOR UPDATE`, body and reference writes, response hydration | `crates/messages/src/outbound/pg_message_repo.rs:787`, commit `:788` | Only COMMIT. |
| Delete message | Message/thread `FOR UPDATE`, tombstone update and its triggers, response hydration | `crates/messages/src/outbound/pg_message_repo.rs:802`, commit `:803` | Only COMMIT. |
| Add/remove reaction | Message/thread `FOR UPDATE`, reaction mutation, response hydration; no-op reaction does not allocate | `crates/messages/src/outbound/pg_message_repo.rs:834`, commit `:838` | Only COMMIT. |
| Patch/delete thread | Thread `FOR UPDATE`, message tombstones when deleting, thread-state update, response preparation | `crates/messages/src/outbound/pg_message_repo/threads.rs:103`; wrapper commits at `:50` | Only returning the prepared state and COMMIT. Channel threads cannot carry PDF anchors, so highlight resolution does no SQL. |
| Activity batch | All activity inserts, including deduplication, complete before the ordered batch append | `services/document_storage_service/src/service/activity/persistence.rs:63`, commit `:65` | Only COMMIT. Receipt mapping happens afterward. Non-channel-only batches retain the existing direct activity path at `:54`. |
| End/archive call | Shared team guard, call `FOR UPDATE`, archive/participant/transcript writes, discussion lookup, active-call deletion and its triggers | `crates/call/src/outbound/pg_call_repo/lifecycle.rs:251`, commit `:258` | Only COMMIT. The log target is the canonical call/root id. |
| Delete active call | Read call-owned channel/discussion metadata, delete call and its triggers, delete entity-access rows | `crates/call/src/outbound/pg_call_repo.rs:1064`, commit `:1071` | Only COMMIT; no log row if nothing was deleted or the discussion is not a channel thread. |
| Delete call record | Read call-owned channel/discussion metadata, delete record and its triggers, delete entity-access rows | `crates/call/src/outbound/pg_call_repo.rs:2267`, commit `:2274` | Only COMMIT; same no-op/non-channel behavior. |
| Standalone historical batch | Validate and insert all message/reaction/mention rows, locking existing reply roots first | `crates/messages/src/outbound/pg_message_repo/historical.rs:117`; release savepoint `:124`, outer commit `:47` | Savepoint release and COMMIT. Exactly one reset for a nonempty batch. |
| Importer's historical batch | Same message helper | Append `crates/messages/src/outbound/pg_message_repo/historical.rs:117`; outer commit `services/slack_import_worker/src/composition/channel_sink.rs:209` | **Approved exception:** savepoint release, historical channel activity update (`:204`), fenced checkpoint/counters/search outbox/revision completion (`:208`). |
| Importer's historical body patch | Guarded message body update; unchanged/invalidated guard allocates nothing | `crates/messages/src/outbound/pg_message_repo/historical.rs:89`; outer commit `services/slack_import_worker/src/composition/reference_reconciliation.rs:69` | **Approved exception:** close reconciliation intent, update dirty-search generation/outbox and recompute job status via `fenced.finish` (`:68`). |

The importer batch completion is defined in
`crates/slack_integration/src/outbound/pg_slack_import_repo/batches.rs:320`:
it rechecks the fence (`:329`), updates checkpoint/counters (`:334`), updates
search outbox state (`:351`, `:361`) and bumps the revision (`:367`). Historical
body completion is in
`crates/slack_integration/src/outbound/pg_slack_import_repo/references.rs:150`:
it closes the reference intent (`:152`), updates search state (`:158`, `:165`,
`:175`) and calls job recomputation (`:186`). These are real statements under
the counter lock, not a claim that a savepoint release commits the transaction.
Both exceptions retain atomic import checkpointing and extend the
same-channel wait by that completion work.

The public caller-owned `delete_thread_in` helper is used by document annotation
deletion (`crates/macro_db_client/src/annotations/delete_anchor.rs:36`). The only
current caller supplies a document parent, so this path acquires no channel
counter. Channel thread operations use the committing wrapper in the table.

## Deferred checks and lock order

The pre-existing reply FK is `DEFERRABLE INITIALLY DEFERRED`
(`crates/macro_db_client/migrations/20260917175816_messages_parent_aware_schema.sql:62`).
Channel reply creation acquires `FOR KEY SHARE OF m` on the root before any
counter lock (`crates/messages/src/outbound/pg_message_repo/threads.rs:14`,
called at `crates/messages/src/outbound/pg_message_repo.rs:697`). This prevents
COMMIT's deferred root check from first waiting for a root writer that is
already waiting for this transaction's counter. It deliberately neither locks
the thread-state row nor rejects a tombstoned message root; the existing live
thread-state check remains. Ordinary edit/delete/react first lock the message
and thread at `crates/messages/src/outbound/pg_message_repo.rs:341`.
Historical reply validation locks existing roots and thread states before its
reset append (`crates/messages/src/outbound/pg_message_repo/historical.rs:153`).

Commit order here means successful transaction commit order for a channel,
not HTTP response arrival order. The next writer cannot advance the same
counter until its predecessor commits or rolls back. Rollback releases the
counter increment and log insert together with the message/activity/call work.
COMMIT still performs PostgreSQL's normal deferred checks and WAL work; it is
not assumed to have zero duration. No additional explicit application query or
remote call occurs under the counter on the live paths above.

## Timeout behavior

| Scope | Source | Effective application policy |
| --- | --- | --- |
| MacroDB parameter group | `infra/stacks/macrodb/index.ts:95`, `:114` | Declares `idle_in_transaction_session_timeout = 300000` (five minutes). This is an idle-session limit, not an active statement/lock-wait limit. No `lock_timeout` or `statement_timeout` is declared in this parameter list. |
| DSS primary/read-only pools | `services/document_storage_service/src/server.rs:253`, `:274` | No connection startup override or `after_connect` statement/lock timeout. SQLx pool acquisition uses its default, 30 seconds. |
| Agent and authentication compositions | `services/agent_trigger_service/src/main.rs:132`, `services/agent_harness_service/src/main.rs:278`, `services/authentication_service/src/server.rs:171` | These also construct message/call repositories with pools that set neither statement/lock timeouts nor a different acquisition timeout. |
| Import worker pool | `services/slack_import_worker/src/main.rs:56` | Pool acquisition capped at 20 seconds; no statement/lock timeout override. |
| Calendar/prune pool | `services/calendar_service/src/main.rs:60` | No startup statement/lock timeout override; SQLx acquisition defaults to 30 seconds. |
| Channel changes log read and message hydration | `crates/messages/src/outbound/pg_message_repo/changes.rs:26`, `:78` | `SET LOCAL statement_timeout = '15s'`, per statement for that transaction. This is not a 15-second aggregate request deadline. |
| Channel prune batch | `crates/messages/src/outbound/pg_message_repo/changes.rs:148` | `SET LOCAL statement_timeout = '15s'`, including a blocked delete statement. |
| Counter/log allocation for messages, activities, calls and history | `crates/channel_change_db_utils/src/append.rs:14`, `:48`, `:98` | One preflight sets a transaction-local 50 ms total append statement deadline, retaining any stricter nonzero inherited statement timeout. The final append restores that setting. SQL errors abort the transaction; rollback restores its settings. `lock_timeout` is unchanged. |
| Other statements and COMMIT | Write sites above; counter read `crates/messages/src/outbound/pg_message_repo/changes.rs:13` | No new timeout. Inherit database/role/connection settings. The append restores the saved value before subsequent work, including the historical completion exceptions and COMMIT. |
| Reference-repair maintenance: outer future | `crates/slack_integration/src/inbound/worker.rs:45`, `:234`, `:245` | The whole reconciliation pass has a 30-second Tokio timeout. Expiry drops the pass, returns `ImportError::Retryable`, and the maintenance loop waits ten seconds before its next pass (`:238`). This is not a PostgreSQL statement timeout. |
| Main historical import: outer future | `crates/slack_integration/src/inbound/worker.rs:182`, `:194`, `:202`, `:207` | `work.import` has no fixed total-duration timeout. Independent lease and queue heartbeats run every 60 seconds; each heartbeat attempt is bounded by 30 seconds. Heartbeat failure drops the import future. On shutdown, the worker grants a 110-second drain window before dropping remaining work (`:48`, `:88`). |
| Message/call HTTP routes in DSS: outer future | `services/document_storage_service/src/api.rs:58`; `crates/messages/src/inbound/axum_router.rs:52` | No request timeout layer found in the checked-in route composition or message service. The 200 ms tracing-layer argument is a warning threshold, not a deadline (`crates/macro_tower_layers/src/lib.rs:269`). External caller/proxy timeouts were not inspected. |

The SQLx 0.8.6 default was verified in the installed dependency's
`sqlx-core/src/pool/options.rs:160`. Pool acquisition limits do **not** cancel a
statement already running on an acquired connection. A queued request can
therefore time out acquiring a connection even while an earlier acquired
connection continues waiting for a counter. Actual deployed database/role
settings and connection-URL options were not inspected; the table describes
checked-in configuration, not a live production `SHOW` result.

The 50 ms value is a **whole append-statement deadline**, including successive
counter waits in a batch and executor work. It does not reset after each lock
acquisition. PostgreSQL's statement timer starts before query execution;
therefore setting the timeout inside the append would not arm a new timer for
that same statement. The preflight makes the value effective for the next
command. PostgreSQL disables the previous command's timer at command finish
and enables the next one from the current setting; changing the setting during
execution does not itself re-arm or disable the active timer.
[Command timer boundaries](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/tcop/postgres.c#L2601-L2650),
[timer activation](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/tcop/postgres.c#L4877-L4899),
[statement-timeout setting](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/guc_tables.c#L2614-L2623)
The deadline covers the final statement's initial relation locks as well as
its counter waits. It is not a transaction or HTTP deadline, nor a hard
real-time scheduling bound: earlier message/thread locks, the preflight under
its inherited deadline, and deferred checks or WAL work at COMMIT retain their
existing behavior. Historical completion work also retains its prior timeout.

The production DSS primary pool keeps at least 10 and permits at most 50
connections (`services/document_storage_service/src/server.rs:247`). As a rough
steady-arrival estimate,
200–400 contending writes per second multiplied by a 50 ms wait accounts for
10–20 parked connections, plus the current holder. At 400 writes per second,
100 ms would account for 40 parked connections, exceeding half of this pool.
This estimate motivates 50 ms; it is not a connection-occupancy guarantee.
It excludes time in other statements, bursts, retries, timer-delivery delay,
and cancellation/rollback cleanup. This estimate uses the service pool cap, not a deployed database
connection limit.

## Caller-visible failures and rollback

| Caller | Failure propagation |
| --- | --- |
| Message allocation | SQLSTATE `55P03`, or `57014` with the exact English statement-timeout message, from the append helper is classified as `MessageError::Contended` in `crates/messages/src/outbound/pg_message_repo/change_log.rs:13`. The message HTTP adapter returns status 503 with a safe retry message and `Retry-After: 1` (`crates/messages/src/inbound/axum_router.rs:172`). No sequence or success push is returned before repository COMMIT succeeds. |
| Bot webhook message allocation | The same domain failure produces status 503 and `Retry-After: 1` (`crates/bots/src/inbound/channel_webhook_router.rs:402`, `:438`). `Contended` has a stable message that omits the underlying database details. |
| Other message failures | Unrecognized `57014` (including user cancellation or translated timeout text), `40P01` (deadlock), pool errors, and `55P03` outside the append retain `MessageError::Repository` through `crates/messages/src/outbound/pg_message_repo.rs:46`. The HTTP adapter returns status 500 (`crates/messages/src/inbound/axum_router.rs:179`). |
| Call write | Plain repository operations propagate `sqlx::Error`; call service mapping and `From<sqlx::Error>` produce `CallError::Internal` (`crates/call/src/outbound/pg_call_repo/team_share.rs:30`, `crates/call/src/domain/service.rs:2040`). The HTTP adapter returns status 500 with `internal server error` (`crates/call/src/inbound/axum_router.rs:1231`). |
| Activity ingestion | Repository error propagates before realtime publication. The consumer exits without committing that source offset (`crates/activity/src/inbound/kafka_consumer.rs:140`); DSS restarts it after five seconds (`services/document_storage_service/src/server.rs:1131`). Replayed deterministic activity ids can receive another log sequence, preserving the at-least-once log guarantee. |
| Historical import/reconciliation | Repository errors are wrapped as `ImportError::Retryable` (`services/slack_import_worker/src/composition.rs:31`, `channel_sink.rs:194`, `reference_reconciliation.rs:62`); neither checkpoint nor successful body completion commits. |
| Retention | Error returns from the batch without commit; the scheduler logs it and tries again at its next retention interval (`services/calendar_service/src/calendar_outbox.rs:85`). |

An error before COMMIT drops the SQLx transaction; SQLx queues rollback before
the connection can be reused (`sqlx-core/src/transaction.rs:260` in the installed
0.8.6 dependency). Thus a timed-out append does not leave an earlier message
mutation committed and does not consume a sequence. As with existing writes,
a connection loss during COMMIT can leave the client uncertain whether the
server committed; this branch does not add a new retry protocol.

A Tokio timeout drops the Rust future; it does not itself set a PostgreSQL
deadline or guarantee immediate cancellation of an already-sent statement.
SQLx 0.8.6 queues rollback in `sqlx-postgres/src/transaction.rs:73`, then flushes
pending protocol work before returning the connection to the pool
(`sqlx-core/src/pool/connection.rs:307`, `sqlx-postgres/src/connection/mod.rs:85`).
That rollback can remain behind a blocked statement. The 30-second reference
maintenance limit and import cancellation paths therefore bound caller work,
not the lifetime of an active database lock wait. They must not be treated as
substitutes for `lock_timeout` or `statement_timeout`.

## Observed cancellation edge in the earlier 5 ms experiment

The three 5 ms pool-isolation runs produced 22 SQLSTATE `57014` errors
(2, 8 and 12 by run), alongside 620,970 `55P03` errors. Every one of the 22
server log entries reported `canceling statement due to user request` on the
counter append beginning `WITH saved AS MATERIALIZED`; none named ROLLBACK
or reported a statement timeout. Twenty entries included counter tuple/index
context; two had no context. The relevant log window was 2026-11-12
06:42–06:45 UTC. The extracted entries are retained locally in
`/tmp/channel-seq-cancellation-excerpts.log` from `/tmp/channel-seq-pg.log`.
A separate connection afterward reported `statement_timeout=0`,
`lock_timeout=0` and `idle_in_transaction_session_timeout=0`. This checks the
local default connection, not the precise settings of each benchmark connection.

PostgreSQL 18.4's interrupt handler distinguishes a lock-timeout indicator
(`55P03`), a statement-timeout indicator (`57014`), and a pending query cancel
with neither indicator (`57014`, user-request text).
[PostgreSQL interrupt classification](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/tcop/postgres.c#L3196-L3248)
The lock-wait code preserves the lock-timeout indicator when leaving a wait,
but enabling a subsequent timeout clears that timeout's indicator.
[Lock-wait cleanup](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/storage/lmgr/proc.c#L1548-L1563),
[timeout initialization](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/timeout.c#L143-L183)
A plausible interleaving is a timeout arriving as a counter lock is granted,
followed by another lock wait resetting the indicator before the pending
interrupt is processed. This is a source-backed inference, **not a proven
interleaving** in these runs. Restoring `lock_timeout` has no assignment hook
that clears the indicator, so the setting restoration itself has not been
shown to cause the error.
[PostgreSQL lock-timeout setting](https://github.com/postgres/postgres/blob/REL_18_4/src/backend/utils/misc/guc_tables.c#L2624-L2633)

These observations do not establish that every `57014` means contention.
The observed user-request text remains a repository error: HTTP 500 with no
`Retry-After`. The current append recognizes only `55P03` or `57014` with the
exact English statement-timeout text as contention. Other locales fail closed
to a safe 500; see the sender-response section below. The current statement
deadline does not re-arm between lock waits, but the 5 ms counts remain
historical measurements, not proof that any cancellation race is absent.

## Regression evidence and remaining scope

Existing committed tests cover concurrent commit-prefix visibility, uniqueness
and rollback, plus the deferred-root lock cycle:
`channel_reply_locks_its_deferred_fk_before_the_counter` and
`concurrent_channel_replies_and_root_writers_finish_without_deadlocks` in
`crates/messages/src/outbound/pg_message_repo/test/sequences.rs`.

The prior 50 ms **per-lock** implementation passed all six utility tests and
198 message tests, with eight benchmarks ignored by default. Those historical
logs are `/tmp/channel-seq-utils-50ms.log` and `/tmp/channel-seq-messages-50ms.log`;
they do not validate the current statement-deadline implementation. The current
utility cases below passed: seven tests, including the aggregate-wait
regression, in `/tmp/channel-seq-utils-deadline.log`. The full messages suite
for the statement-deadline implementation passed 201 tests with eight ignored
benchmarks in `/tmp/channel-seq-messages-deadline.log`.

- `channel_counter_wait_timeout_rolls_back_the_entire_message` in
  `crates/messages/src/outbound/pg_message_repo/test/sequences.rs` holds the
  counter while a different message reaches its final append. Cases cover the
  50 ms statement deadline, an inherited 1 ms lock timeout, and an inherited
  10 ms statement timeout; they check typed contention, preserved database
  cause, absent message, unchanged counter and a gap-free successful retry.
- `channel_counter_wait_is_bounded_with_database_timeouts_disabled` verifies
  a default-timeout connection still gets the append deadline, returns its
  pooled setting to zero after rollback, and succeeds after releasing the holder.
- `append_restores_stricter_disabled_and_longer_timeouts`,
  `counter_timeout_rolls_back_prior_and_partial_batch_changes`, and
  `a_later_statement_keeps_the_callers_longer_statement_timeout` in
  `crates/channel_change_db_utils/src/test/timeout.rs` cover scalar/batch
  restoration, unchanged lock timeout, atomic rollback and later SQL.
- `batch_deadline_bounds_the_total_of_multiple_short_counter_waits` in that
  utility file checks that successive individually short waits still exhaust
  the batch's one statement deadline and roll back the batch.

The user-deletion `cleanup_user_call_entities` cascade is deliberately outside
this PR's sequence coverage. A retained channel call root can keep its prior
call status in an already-populated device cache until that row is next fetched
or the channel is reset. This path remains excluded to avoid holding channel counter locks through
the remainder of user deletion.

## Sender response and retry behavior

The message API and channel bot webhook return the same public response for a
counter append that fails with SQLSTATE `55P03`, or with SQLSTATE `57014` and
the exact primary message `canceling statement due to statement timeout`: HTTP **503**, header
**`Retry-After: 1`**, and JSON
`{"message":"channel is busy; retry the request"}`. The adapter classifies only
these recognized append timeouts as `MessageError::Contended`, retaining the database
report internally
([change_log.rs:13](../src/outbound/pg_message_repo/change_log.rs#L13),
[ports.rs:27](../src/domain/ports.rs#L27)). Both HTTP adapters set the header
and keep the underlying cause out of that body
([message HTTP:166](../src/inbound/axum_router.rs#L166),
[webhook HTTP:397](../../bots/src/inbound/channel_webhook_router.rs#L397)).

SQLSTATE `57014` with any other primary message, including
`canceling statement due to user request`, remains `MessageError::Repository`
([database_error:46](../src/outbound/pg_message_repo.rs#L46)). The message API
and channel bot webhook both answer **500**, with **no `Retry-After` header**,
and JSON `{"message":"message operation failed"}`. They log the underlying
report for diagnosis without returning it
([message HTTP:179](../src/inbound/axum_router.rs#L179),
[webhook logging/body:424](../../bots/src/inbound/channel_webhook_router.rs#L424)).
The webhook regression test asserts both this safe body and the absent header
([tests.rs:59](../../bots/src/inbound/channel_webhook_router/tests.rs#L59)).

The `57014` discriminator assumes English PostgreSQL primary messages. The
server's [`lc_messages` setting](https://www.postgresql.org/docs/14/runtime-config-client.html#GUC-LC-MESSAGES)
controls their language and can inherit the host environment. The dedicated
PostgreSQL 14 and 18 proof clusters use `C.UTF-8`; no checked-in production
locale override was found. Unrecognized or translated cancellation text fails
closed to the safe repository-error 500 response, never misclassifies a user
cancel as retryable, and does not disable the statement deadline. Outbound-only
unit tests preserve the original SQLSTATE/message for both recognized timeouts
and other cancellations
([change_log/test.rs](../src/outbound/pg_message_repo/change_log/test.rs)).

Neither request path retries either failure on the server. Repository creation
uses `?` on the append immediately before commit
([pg_message_repo.rs:753](../src/outbound/pg_message_repo.rs#L753)); the service
propagates failure before success publication
([service.rs:435](../src/domain/service.rs#L435)). The HTTP and webhook handlers
each await one service post
([message handler:269](../src/inbound/axum_router.rs#L269),
[webhook handler:287](../../bots/src/inbound/channel_webhook_router.rs#L287)).
This statement concerns these synchronous message requests; activity ingestion
and import workers have the separate retry behavior described above.

The current **web sender does not retry 503 or 500** and does not consume the
header or server JSON explanation. Its message client passes no retry setting
([messages.ts:93](../../../apps/web/src/lib/service-clients/service-storage/messages.ts#L93));
`safeFetch` defaults to one attempt, maps 503 to `HTTP_ERROR`, and returns it
immediately
([safeFetch.ts:116](../../../apps/web/src/lib/core/util/safeFetch.ts#L116),
[safeFetch.ts:290](../../../apps/web/src/lib/core/util/safeFetch.ts#L290),
[safeFetch.ts:318](../../../apps/web/src/lib/core/util/safeFetch.ts#L318)). The
send mutation only handles a 409 by reading its already-stored id
([mutations.ts:448](../../../apps/web/src/lib/queries/messages/mutations.ts#L448));
the application configures retries for queries, not mutations
([client.ts:15](../../../apps/web/src/lib/queries/client.ts#L15)), and the
installed TanStack Query mutation default is zero retries
(`node_modules/@tanstack/query-core/src/mutation.ts:199`). Authentication
refresh retries concern 401, not these failures
([fetchWithToken.ts:123](../../../apps/web/src/lib/core/util/fetchWithToken.ts#L123)).
On failure the web shows `Failed to send message`, removes the optimistic row,
and restores the sent draft if it has not been replaced by newer input
([mutations.ts:539](../../../apps/web/src/lib/queries/messages/mutations.ts#L539),
[Channel.tsx:825](../../../apps/web/src/features/channel/Channel/Channel.tsx#L825),
[thread composer:163](../../../apps/web/src/features/channel/Thread/ThreadReplyChannelInput.tsx#L163)).

The **SDK also does not automatically retry**. Its channel send chooses one
message-API or webhook call
([post.ts:42](../../../packages/sdk/src/entities/channels/post.ts#L42),
[post.ts:86](../../../packages/sdk/src/entities/channels/post.ts#L86)); the
generated client executes one fetch
([client.gen.ts:101](../../../packages/sdk/generated/storage/client/client.gen.ts#L101)),
and its configured interceptor adds authorization only
([client.ts:287](../../../packages/sdk/src/utils/client.ts#L287)). `unwrap`
throws `MacroApiError(status, data)`; that high-level error does not retain
response headers
([unwrap.ts:32](../../../packages/sdk/src/utils/unwrap.ts#L32),
[unwrap.ts:91](../../../packages/sdk/src/utils/unwrap.ts#L91)). A 503 therefore
throws `Macro API error 503: channel is busy; retry the request`. A sender must
implement its own delayed retry policy or retry manually; the header advertises
the delay, but does not cause existing clients to wait and resend. Behavior of
external webhook programs outside this repository is not established here.
