# Channel writer rates and admission

The current process admits at most **four concurrent writes per typed parent**,
with a **two-second wait before pool acquisition**. The registry is shared by
repository instances and pools in that process
([`message_write_gate/src/lib.rs:19`](../../message_write_gate/src/lib.rs#L19),
[`:207`](../../message_write_gate/src/lib.rs#L207)). This applies to channel
messages, selected activities, call status writes and import compositions.
Idle entries disappear when their last permit or waiter drops (`:87`).

This is not a per-channel time-rate limit. Fast transactions can complete many
times per second, and separate processes have independent gates. With N active
processes, the code can admit up to 4N operations for a parent; operations can
also retain more than one connection when they include a journal lease and a
nested message write. There is still no general code-enforced ceiling of 200
channel writes/s or sequence rows/s.

If a transaction occupied the counter lock for exactly 5 ms, its arithmetic
serialization ceiling would be 200 transactions/s. That is a hypothetical
service time, not the five-second lock-wait guard or a production measurement.
Activity transactions can append multiple sequences in one acquisition, so it
is not a 200-sequence-rows/s bound. The append remains the final statement before
commit, except for the approved historical completion work described in the
[transaction audit](channel_transaction_audit.md).

| Writer | Source-level controls | Remaining rate behavior |
| --- | --- | --- |
| Message API and external webhook | Authorization/input checks, then four-writer per-parent admission before the write connection; no general per-channel rate limiter. | One sequence per committed mutation. Callers can sustain back-to-back work; excess admission waits up to two seconds, then returns a retryable busy response. |
| Agent reply presentation | One command worker per session; changed-shape/ready checks coalesce updates; same parent gate covers repository writes and caller-owned journal scopes. | No wall-clock interval between changed replies. Several sessions can target the same channel, subject to the per-process gate. |
| Built-in bot response | One initial post and one final patch per response, each admitted through the message service. | Invocations spawn independently; the parent gate bounds concurrent writes, not invocations or requests/s. |
| Historical import | At most 500 messages / 4 MiB per batch, one or two lanes per worker process, sorted parent admission before the import fence. | One reset per nonempty batch. Batches run back-to-back without persistence pacing. |
| Reference repair | Up to 50 attempts per pass, ten seconds between completed passes, parent admission before the write transaction. | At most 50 changed-body sequences per pass. Busy/ineligible jobs advance a persistent cursor so later jobs can progress. |
| Call end/delete | One active call per channel, changed-only root logging, parent admission before the write transaction; new-call starts have a separate account budget. | Record deletions have no time-rate limit. The start budget does not limit existing record deletions or other channel writers. |
| Timeline activities | One source event per consumer at a time; sorted parent admission before the activity transaction. | A batch can append many sequences to one channel, and replay intentionally allocates again. No fixed activity-count or per-channel time-rate cap. |

## Agent updates are coalesced, not time-throttled

The fold omits unfinished prose from its progress shape and emits `Progressed`
only when the shape changes
([`lifecycle.rs:52`](../../folds/agent_fold/src/domain/lifecycle.rs#L52),
[`:97`](../../folds/agent_fold/src/domain/lifecycle.rs#L97)). The presenter keeps
content in the comparison shape only for sealed segments
([`presenter.rs:97`](../../agent_harness/src/domain/presenter.rs#L97)). Segmented
messages must be ready and different before presentation
([`present.rs:204`](../../agent_harness/src/domain/service/present.rs#L204)); writes
are awaited sequentially (`:218`), and finalization skips unchanged non-final
messages (`:287`). Thus token streaming into one unfinished passage does not
imply one channel write per token, but completed passages and sealed changes
have no enforced delay between them.

The session command channel is unbounded
([`queue.rs:152`](../../agent_harness/src/domain/service/queue.rs#L152)). The
50-action cap is per-session queued actions
([`domain/queue.rs:48`](../../agent_harness/src/domain/queue.rs#L48)), not a
channel-wide rate limit. Repository admission now coordinates writers from
those sessions within a process. Conversation bootstrap and reply recovery
acquire it before retaining journal connections; see the transaction audit.

The 1,500 ms / 50 ms timers and 256-frame trigger belong to durable **session
log** flushing
([`agent_session/service.rs:1811`](../../agent_session/src/domain/service.rs#L1811)).
They are not channel-message pacing. The actor forwards fold signals to its
observer without that flush timer
([`actors.rs:796`](../../agent_session/src/domain/session/actors.rs#L796)).

## Direct messages and bots

The message routes use the authorized service and repository gate; they do not
add a per-channel requests/s limiter
([`axum_router.rs:255`](../src/inbound/axum_router.rs#L255)). Tool callers can also
post through that service, so human typing speed is not a workload bound.

The external webhook still supplies neither a message ID nor a nonce
([`channel_webhook_router.rs:287`](../../bots/src/inbound/channel_webhook_router.rs#L287)).
An admission 503 happens before its write starts; a successful retry then
creates one message. Retrying after an **unknown** commit outcome can create
another message, as before. The accepted scope keeps that endpoint unchanged;
this admission change introduces no idempotency key. The 503 response carries
`Retry-After: 1` (`:402`, `:435`).

The built-in bot posts, awaits its responder, then patches once
([`service.rs:616`](../../channel_bots/src/domain/service.rs#L616),
[`:639`](../../channel_bots/src/domain/service.rs#L639),
[`:660`](../../channel_bots/src/domain/service.rs#L660)). Its responder collects
streamed content before returning
([`agent_loop_responder.rs:63`](../../channel_bots/src/outbound/agent_loop_responder.rs#L63));
it does not patch on every chunk. Candidates spawn independently
([`bot_trigger_router.rs:93`](../../channel_bots/src/inbound/bot_trigger_router.rs#L93)),
with admission applied when they write.

## Import and repair bursts

Historical batch limits remain 500 messages and 4 MiB
([`historical.rs:14`](../src/domain/historical.rs#L14)). The import worker allows
one or two lanes
([`worker.rs:34`](../../slack_integration/src/inbound/worker.rs#L34)), and flushes
full batches without a time-based persistence delay
([`importer.rs:199`](../../slack_integration/src/domain/importer.rs#L199)). The
composition admits sorted target channels before acquiring its fence and
checks the fenced target before writing
([`channel_sink.rs:100`](../../../services/slack_import_worker/src/composition/channel_sink.rs#L100)).
A nonempty helper batch logs one reset, not one sequence per imported message
([`historical.rs:120`](../src/outbound/pg_message_repo/historical.rs#L120)).

Reference repair attempts at most 50 jobs per pass
([`reference_reconciliation.rs:102`](../../../services/slack_import_worker/src/composition/reference_reconciliation.rs#L102));
maintenance waits ten seconds after the pass
([`worker.rs:240`](../../slack_integration/src/inbound/worker.rs#L240)). This gives
an upper bound of five attempts/s sustained per worker, but permits a burst of
50 and does not bound replica count. Each busy admission advances the cursor
before another job is tried; successful work drains its job before advancing.
Discovery uses a released read connection, followed by admission and fenced
identity revalidation (`reference_reconciliation.rs:40`). Only a changed body
allocates a sequence; unchanged/invalidated guards remain silent.

## Calls and activity batches

Call archival removes a live call and appends one canonical call-root change
before commit
([`lifecycle.rs:254`](../../call/src/outbound/pg_call_repo/lifecycle.rs#L254)).
Deleting active or recorded calls likewise logs only actual deletion
([`pg_call_repo.rs:1063`](../../call/src/outbound/pg_call_repo.rs#L1063),
[`:2269`](../../call/src/outbound/pg_call_repo.rs#L2269)). Channel discovery is a
released primary-key read; admission precedes the transaction and the channel
is rechecked (`lifecycle.rs:281`). Other call mutations do not enter this
sequence path. The new-call start budget remains 20/hour **per account**
([`axum_router.rs:76`](../../call/src/inbound/axum_router.rs#L76)); it is not a
channel-wide rate limit.

DSS derives selected activity parents, acquires sorted channel permits, inserts
the full batch and allocates sequences in one transaction
([`persistence.rs:52`](../../../services/document_storage_service/src/service/activity/persistence.rs#L52)).
The activity crate remains channel-agnostic. The batch append groups by channel
and preserves per-channel input order
([`append.rs:68`](../../channel_change_db_utils/src/append.rs#L68)). Replayed
activity IDs deliberately receive new sequences. Consumer serialization
([`kafka_consumer.rs:140`](../../activity/src/inbound/kafka_consumer.rs#L140))
does not impose a numeric batch-size or requests/s limit.

These are source-level bounds. They do not establish deployed traffic rates,
replica counts or actual counter-lock occupancy. The current fixed-arrival
admission proofs and historical experiments remain separate artifacts.
