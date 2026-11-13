# Channel sequence admission and transaction audit

The current implementation allows at most four live global admissions per typed
message parent per process, waiting at most two seconds **before** borrowing a
write connection. The counter append has a separate five-second PostgreSQL lock-wait guard. The
previous 50 ms statement deadline is historical and is not the current policy.

## Admission and database boundaries

The process-wide registry is shared across repository instances and pools. Its
key is `(parent_type, parent_id)`; channels use `("channel", channel_uuid)`.
The limits are defined in
[`message_write_gate/src/lib.rs:19`](../../message_write_gate/src/lib.rs#L19).
Admission includes pending waiters in its registry lifetime accounting and
removes an entry when its final waiter or permit drops
([`:87`](../../message_write_gate/src/lib.rs#L87)). This is a concurrency limit,
not a requests-per-second limit or a cross-process quota.

Normal awaited execution retains the permit through COMMIT. Dropping a write
future can release that permit before SQLx finishes its outstanding query or
rollback; the cap bounds live admitted futures, not all lingering database
cleanup. Four admitted operations can also hold more than four connections when
an operation has a journal lease plus a nested message write.

All current message parents use admission, including document comments; only
channel parents append a sequence. The non-channel SQL branch remains unchanged
([`change_log.rs:54`](../src/outbound/pg_message_repo/change_log.rs#L54)).
Caller-owned `_in` helpers require their caller to acquire the permit before
opening the outer transaction; they do not acquire another global permit after
borrowing a connection.

| Write | Admission / transaction entry | Final channel append and commit | Work after the counter is acquired |
| --- | --- | --- | --- |
| Create root/reply | `pg_message_repo.rs:654`, begin `:655`; canonical-root and reply-root validation precede append | append `:754`, commit `:755` | COMMIT, including deferred constraints. |
| Edit | `pg_message_repo.rs:765`, begin `:766`; message/thread locks, body/references and hydration first | append `:789`, commit `:790` | COMMIT. |
| Delete message | `pg_message_repo.rs:799`, begin `:800`; locks, tombstone triggers and hydration first | append `:805`, commit `:806` | COMMIT. |
| React | `pg_message_repo.rs:818`, begin `:819`; locks, reaction change and hydration first | changed-only append `:838`, commit `:842` | COMMIT. No-op reaction allocates no sequence. |
| Patch/delete thread | `pg_message_repo/threads.rs:49`, begin `:50` | append `:105`, wrapper commit `:52` | Return prepared state and COMMIT. Channel threads have no PDF-anchor lookup. |
| Standalone historical batch | `pg_message_repo/historical.rs:45`, begin `:49` | reset append `:123`, savepoint release `:130`, outer commit `:51` | Savepoint release and COMMIT. Empty batches append no reset. |
| Imported historical batch | `channel_sink.rs:113`, begin `:118`; fenced target recheck `:121` | reset in `historical.rs:123`, outer commit `channel_sink.rs:230` | **Approved exception:** savepoint release, historical activity update `:225`, checkpoint/counters/search completion `:229`. |
| Imported reference repair | `reference_reconciliation.rs:40` discovery, permit `:44`, begin `:53`, identity recheck `:60` | changed-only append `historical.rs:94`, outer commit `reference_reconciliation.rs:97` | **Approved exception:** reference/search/job completion `:96`. |
| Channel timeline activities | `activity/persistence.rs:65`, begin `:72`; insert all activities `:74` | batch append `:78`, commit `:80` | COMMIT; receipt mapping follows it. |
| Archive/end call | `pg_call_repo/lifecycle.rs:13`, begin `:14`; archive writes and discussion recheck `:221` first | append `:258`, commit `:265` | COMMIT. |
| Delete active call | `pg_call_repo.rs:1042`, begin `:1044`, target recheck `:1045`; deletion/access cleanup first | append `:1067`, commit `:1074` | COMMIT; append only for an actual channel deletion. |
| Delete call record | `pg_call_repo.rs:2248`, begin `:2250`, target recheck `:2251`; deletion/access cleanup first | append `:2273`, commit `:2280` | COMMIT; same no-op/non-channel rule. |

Message paths above are in
[`crates/messages/src/outbound`](../src/outbound/pg_message_repo.rs#L654);
import paths are in
[`services/slack_import_worker/src/composition`](../../../services/slack_import_worker/src/composition/channel_sink.rs#L100);
activity is in
[`services/document_storage_service/src/service`](../../../services/document_storage_service/src/service/activity/persistence.rs#L47);
call paths are in
[`crates/call/src/outbound`](../../call/src/outbound/pg_call_repo/lifecycle.rs#L7).

The historical batch exception retains atomic import checkpointing: its
completion updates checkpoint/counters, search state/outbox and revision
([`batches.rs:320`](../../slack_integration/src/outbound/pg_slack_import_repo/batches.rs#L320)).
Reference completion closes the intent, updates search generation/outbox and
recomputes the job
([`references.rs:222`](../../slack_integration/src/outbound/pg_slack_import_repo/references.rs#L222)).
Those statements really run while the counter lock is held. Releasing the
message helper's savepoint does not commit the outer import transaction.

## Discovery and coverage

| Caller-owned flow | Before admission | Recheck / lifetime |
| --- | --- | --- |
| Imported batch | Sorted unique channel IDs come from the bounded message plan; no discovery query is needed. | Compare the authoritative fenced channel with admitted IDs before message writes (`channel_sink.rs:119`). Hold permits through checkpoint completion and commit. An empty plan acquires no channel permit. |
| Reference repair | `references::peek_next` seeks a pending job/message/channel identity and releases its pool connection (`references.rs:94`). | Reacquire the job fence by primary key (`next_for_job_in`, `:152`); compare job, message and channel (`reference_reconciliation.rs:60`) before writing. The worker cursor is locked before any connection, advances past busy/ineligible/changed jobs, drains successful jobs, and resets only at end of keyspace (`:102`). |
| Call status writes | Reuse the existing primary-key call-discussion query through the pool, releasing that connection before `message_write_gate::acquire` (`lifecycle.rs:285`). | Archive rechecks inside its transaction before logging; delete paths recheck immediately after begin. A changed target aborts without commit (`lifecycle.rs:309`). Non-channel discussions receive no channel permit/log. |
| Timeline activity | The input batch supplies channel IDs; acquire sorted unique channel permits. | Hold through all activity inserts, sequence allocation and commit. Non-channel-only batches keep the existing direct activity path (`persistence.rs:53`). |
| Document annotation deletion | The authorized document ID is known; acquire its document-parent permit before begin (`delete_anchor.rs:23`). | Existing `delete_thread_in` runs under that permit (`:39`), through commit (`:50`); it never appends a channel change. |
| Agent conversation bootstrap | Parent comes from the incoming origin before the delivery lease (`queue.rs:354`). | Recheck durable origin (`:406`) and retain admission around the caller-owned work. |
| Agent terminal reply reconciliation | Parent comes from the turn before `claim_reply` can retain a journal connection (`deliver.rs:606`). | Recheck the durable saved flight (`:640`); scope surrounds reconciliation and finalization (`:689`). |
| Agent external reply reconciliation | Read target without retaining a journal lease (`external_replies.rs:184`). | Acquire admission before `claim`, then reread/compare the target (`:210`) before presentation. |

The agent announcer acquires the same process-wide key
([`channel_announcer.rs:359`](../../agent_harness/src/outbound/channel_announcer.rs#L359)).
Its task-local scope lets nested same-parent repository writes reuse that outer
admission with one nested writer at a time
([`message_write_gate/src/lib.rs:142`](../../message_write_gate/src/lib.rs#L142)).
It is not inherited by spawned tasks. The scope avoids waiting for a second
global slot while holding a journal connection; unrelated parents acquire their
own permits.

Call-ID-only and reference-maintenance inputs do not contain an authoritative
channel ID, so their released discovery reads necessarily precede admission.
They are short reads, not connections parked while waiting for a slot. Call
status operations now execute the existing metadata read once more for this
purpose. Discovery is not authorization: the transaction rechecks identity and
keeps the existing authorization/fence rules.

The activity crate remains unaware of channels. DSS supplies the channel-aware
composition, using `timeline_parent`; selected activities and their log rows
commit atomically. Replayed deterministic activity IDs may get another sequence,
providing the required at-least-once log guarantee.

## Counter ordering and timeout scope

The scalar append increments the counter and inserts the log in one statement
([`append.rs:12`](../../channel_change_db_utils/src/append.rs#L12)). The activity
batch locks channels in sorted order and allocates each channel's sequences in
input order ([`:68`](../../channel_change_db_utils/src/append.rs#L68)). Both save
`lock_timeout`, set the smaller nonzero inherited value or five seconds before
counter allocation, then restore it in the same statement (`:28`, `:85`).
There is no timeout-setting round trip, and no new statement deadline.

The counter row lock lasts to transaction end. A visible sequence K therefore
includes every committed change below K; another writer cannot increment that
channel counter before the earlier transaction commits or rolls back. Counter,
log and content changes roll back together. Response/push arrival order is not
used as commit order.

Channel reply creation acquires `FOR KEY SHARE OF m` on its existing root before
counter acquisition
([`threads.rs:9`](../src/outbound/pg_message_repo/threads.rs#L9)), so its deferred
foreign-key check cannot first wait for a root writer already waiting on this
transaction's counter. It neither locks the thread-state row nor rejects a
message tombstone if the thread remains live. Historical reply validation also
locks existing roots before appending its reset.

The two-second limit covers admission waiting only. The five-second guard
covers each counter lock wait after the configuration CTE, not total statement
or request duration; successive waits may cumulatively exceed it. Earlier
message/thread waits, relation locks acquired before that CTE, the approved
historical completion work and COMMIT retain their inherited settings, often
zero (unlimited). No five-second total bound is asserted. Separate processes
have separate four-writer limits.

The changes read and prune transactions retain their explicit 15-second
statement timeouts
([`changes.rs:26`](../src/outbound/pg_message_repo/changes.rs#L26),
[`:78`](../src/outbound/pg_message_repo/changes.rs#L78),
[`:148`](../src/outbound/pg_message_repo/changes.rs#L148)). DSS's production pool
is 10 minimum / 50 maximum with SQLx's default 30-second acquire timeout
([`server.rs:247`](../../../services/document_storage_service/src/server.rs#L247)).
Pool-acquire timeouts do not cancel queries already running on a connection.
The pre-existing five-minute idle-transaction setting is also not an active
statement deadline. No live production settings were inspected for this audit.

## Cancellation boundary

A cancelled global admission waiter has no write connection. Dropping it removes
its waiter and registry lease; the final lease removes the parent entry
([`message_write_gate/src/lib.rs:87`](../../message_write_gate/src/lib.rs#L87),
[`:192`](../../message_write_gate/src/lib.rs#L192)). An already-admitted task-local
nested wait is different: the outer journal lease can exist, but that wait does
not add another global admission.

Once a Rust write is running, cancellation can drop its permit while an SQLx
query or rollback is still completing. This applies to ordinary repository
writes, thread and historical wrappers, caller-owned activity/call/import
transactions, and cancelled agent scopes
([`scope:149`](../../message_write_gate/src/lib.rs#L149)). The limits above do
not bound that remaining database lifetime. Normal awaited COMMIT still retains
the permit; counter, log and message changes remain one atomic transaction.

Writes execute in their caller's future. No detached task retains the permit
until database cleanup finishes after that future is cancelled. Agent journal
lease and nested message-write lifetimes remain tied to their caller scope.
Cancellation during COMMIT can leave its outcome unknown to the caller.

## Caller-visible failures and retry boundaries

| Caller | Behavior |
| --- | --- |
| Messages | Typed `AdmissionTimeout` becomes `MessageError::Contended` before the write connection (`change_log.rs:28`). Only append SQLSTATE `55P03` also maps to that variant (`:14`); unrelated cancellation remains a repository error. HTTP returns safe 503 / `Retry-After: 1` (`axum_router.rs:172`). Success events follow successful COMMIT only. |
| External bot webhook | The same `Contended` error maps to safe 503 / `Retry-After: 1` (`channel_webhook_router.rs:402`, `:435`). A rejected admission occurs before the write, so a successful retry creates one message. The endpoint still sends no client ID or nonce (`:292`, `:301`): a retry after an unknown commit outcome is not deduplicated, as before. |
| Calls | Typed admission failure is preserved inside SQLx I/O and mapped to `CallError::Contended` (`team_share.rs:30`). Call HTTP returns safe 503 / `Retry-After: 1` (`axum_router.rs:1231`, `:1255`). Other SQL/I/O failures remain internal errors. The generic entity-mutation surface has no retryable variant and keeps its existing internal-error envelope (`entity_mutation.rs:45`). |
| Agent replies | Admission failure and message `Contended` become `HarnessError::ReplyBusy` (`channel_announcer.rs:368`, `:669`). Conversation commands stay queued for recovery (`queue.rs:1856`); terminal reconciliation logs the failure without finalizing it (`deliver.rs:689`). This is distinct from a generic announcement failure. |
| Historical batch | Admission/fence/database failures propagate as `ImportError::Retryable` before successful checkpoint commit. |
| Reference repair | A busy parent advances the cursor and lets the pass try another job; no connection or write transaction has started (`reference_reconciliation.rs:44`). Fence/identity races similarly roll back and advance. Other failures retain retryable propagation. |
| Activity | Admission or insert failure occurs before realtime publication and source acknowledgement. The consumer replays; deterministic IDs can receive fresh log sequences. |
| Retention | A failed batch does not commit; the scheduler logs it and retries at the next retention interval. |

An explicit admission 503 says this attempt never started its write transaction.
An append lock timeout rolls back preceding transaction work and consumes no
sequence. Neither case makes arbitrary network retries idempotent: a connection
loss during COMMIT can leave the caller unsure whether the server committed.
This change adds no new retry protocol or webhook idempotency key.

## Evidence and remaining scope

The proof entry points cover gap-free concurrent commit-prefix reads,
reply/root lock ordering, unchanged non-channel SQL, twenty simultaneous posts
with normal and 5 ms-held commits, and fixed-arrival flood/neighbor admission.
See [README.md](README.md) for the current commands and artifact names. Earlier
5/50 ms per-lock and 50 ms total-deadline experiments are explicitly historical;
their results do not measure this admission implementation.

The user-deletion `cleanup_user_call_entities` cascade remains explicitly
excluded. A retained channel call root can keep its old cached call status until
its next fetch or channel reset. Other call mutations that do not change the
rendered channel call-root status remain outside this log path.
