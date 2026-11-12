# Channel sequence transaction and timeout audit

Static audit of the implementation against base `354da677b5`. Source locations
below identify the production transaction boundaries; benchmark changes do not
change those boundaries. No database configuration was changed for this audit.

## Counter lock and commit boundaries

`channel_change_db_utils::append_in` increments the counter and inserts the log
row in one statement (`crates/channel_change_db_utils/src/append.rs:20`). Its
row lock remains held until the caller's transaction ends. The batch equivalent
locks counters in channel-id order and allocates each channel's sequences in
input order (`crates/channel_change_db_utils/src/append.rs:57`). The new tables
have no foreign keys or triggers that acquire another domain's row lock
(`crates/macro_db_client/migrations/20261110150956_channel_change_log.sql:3`).

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
| Channel prune batch | `crates/messages/src/outbound/pg_message_repo/changes.rs:146` | `SET LOCAL statement_timeout = '15s'`, including a blocked delete statement. |
| Channel counter reads/writes, activity append, calls and history: database statements | Write sites above; `crates/messages/src/outbound/pg_message_repo/changes.rs:13` | No new database timeout. Inherit database/role/connection settings. With PostgreSQL's disabled statement/lock timeout values, the repository does not impose a deadline on an active counter statement. Outer caller deadlines are separate, below. |
| Reference-repair maintenance: outer future | `crates/slack_integration/src/inbound/worker.rs:45`, `:234`, `:245` | The whole reconciliation pass has a 30-second Tokio timeout. Expiry drops the pass, returns `ImportError::Retryable`, and the maintenance loop waits ten seconds before its next pass (`:238`). This is not a PostgreSQL statement timeout. |
| Main historical import: outer future | `crates/slack_integration/src/inbound/worker.rs:182`, `:194`, `:202`, `:207` | `work.import` has no fixed total-duration timeout. Independent lease and queue heartbeats run every 60 seconds; each heartbeat attempt is bounded by 30 seconds. Heartbeat failure drops the import future. On shutdown, the worker grants a 110-second drain window before dropping remaining work (`:48`, `:88`). |
| Message/call HTTP routes in DSS: outer future | `services/document_storage_service/src/api.rs:58`; `crates/messages/src/inbound/axum_router.rs:48` | No request timeout layer found in the checked-in route composition or message service. The 200 ms tracing-layer argument is a warning threshold, not a deadline (`crates/macro_tower_layers/src/lib.rs:269`). External caller/proxy timeouts were not inspected. |

The SQLx 0.8.6 default was verified in the installed dependency's
`sqlx-core/src/pool/options.rs:160`. Pool acquisition limits do **not** cancel a
statement already running on an acquired connection. A queued request can
therefore time out acquiring a connection even while an earlier acquired
connection continues waiting for a counter. Actual deployed database/role
settings and connection-URL options were not inspected; the table describes
checked-in configuration, not a live production `SHOW` result.

## Caller-visible failures and rollback

| Caller | Failure propagation |
| --- | --- |
| Message write/read | SQLSTATE `55P03` (lock timeout), `57014` (statement cancellation), `40P01` (deadlock) and pool errors are not special-cased by `database_error` (`crates/messages/src/outbound/pg_message_repo.rs:46`); they remain `MessageError::Repository`. The message HTTP adapter returns status 500 with `message operation failed` (`crates/messages/src/inbound/axum_router.rs:168`). No sequence or success push is returned before repository COMMIT succeeds. |
| Call write | Plain repository operations propagate `sqlx::Error`; call service mapping and `From<sqlx::Error>` produce `CallError::Internal` (`crates/call/src/outbound/pg_call_repo/team_share.rs:30`, `crates/call/src/domain/service.rs:2038`). The HTTP adapter returns status 500 with `internal server error` (`crates/call/src/inbound/axum_router.rs:1231`). |
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

## Regression evidence and remaining scope

Existing committed tests cover concurrent commit-prefix visibility, uniqueness
and rollback, plus the deferred-root lock cycle:
`channel_reply_locks_its_deferred_fk_before_the_counter` and
`concurrent_channel_replies_and_root_writers_finish_without_deadlocks` in
`crates/messages/src/outbound/pg_message_repo/test/sequences.rs`.

The following additional regression tests passed in release mode against the
dedicated local PostgreSQL 18.4 database (two passed, zero failed):

- `channel_counter_wait_timeout_rolls_back_the_entire_message`
  (`crates/messages/src/outbound/pg_message_repo/test/sequences.rs:451`): holds
  the counter on one connection, makes another create a message then time out
  at the final append with both `lock_timeout = 75ms` and
  `statement_timeout = 75ms`, verifies the preserved SQLSTATE, absent message,
  unchanged visible counter and gap-free next successful sequence.
- `channel_counter_wait_without_timeouts_resumes_after_holder_rolls_back`
  (`crates/messages/src/outbound/pg_message_repo/test/sequences.rs:525`): with
  both timeout settings disabled, the writer remains pending for 150ms and
  resumes with the expected sequence once the holder rolls back.

The user-deletion `cleanup_user_call_entities` cascade is deliberately outside
this PR's sequence coverage. A retained channel call root can keep its prior
call status in an already-populated device cache until that row is next fetched
or the channel is reset. This path remains excluded to avoid holding channel counter locks through
the remainder of user deletion.
