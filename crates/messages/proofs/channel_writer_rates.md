# Single-channel writer rates

The code does **not** establish that a channel stays below 200 contending write
transactions per second. External webhook posts, ordinary message mutations,
and agent presentations have no enforced per-channel time limit in the paths
below. They can submit enough concurrent work to approach a hypothetical 5 ms
serialized counter service time. This is a source-code finding, not an observed
production rate or a claim that the measured repository latency equals counter
lock duration.

At a constant 5 ms **counter-lock occupancy**, the arithmetic ceiling is
`1 / 0.005 = 200` transactions/s for one channel. Actual occupancy includes the
append and the time until commit, and must be measured separately. The append
helper explicitly belongs immediately before commit
([append.rs:8](../../channel_change_db_utils/src/append.rs#L8)). A transaction
can allocate multiple sequence numbers: activity batches advance a channel's
counter once by the batch size
([append.rs:59](../../channel_change_db_utils/src/append.rs#L59)). Therefore 200
**sequence rows**/s is not the corresponding batch ceiling.

| Writer | Enforced bound | What can reach one channel |
| --- | --- | --- |
| Message API and external bot webhook | Authorization and input validation; no per-channel request-rate limiter in these routers or their service mount | One sequence per committed mutation; concurrent callers can keep the channel counter contended. No numeric requests/s ceiling can be derived from this code. |
| Agent reply presentation | One command worker per session; unchanged shapes/content are suppressed; open prose is excluded from progress projection | Writes follow passage/segment changes and finalization, not every token. No wall-clock throttle or cross-session channel cap; several sessions can write the same channel. |
| Built-in bot response | One initial message, then one final patch per completed response | Normally two sequence changes per invocation. Invocations spawn independently; no per-channel concurrency or time cap here. |
| Historical import | At most 500 messages and 4 MiB per batch; one or two import lanes per worker process | One `reset` sequence per nonempty committed batch, not one per imported message. Batches run back-to-back without pacing. No numeric batches/s cap. |
| Imported-reference repair | At most 50 attempts per maintenance pass; at least 10 seconds between completed passes per worker process | At most 50 changed-message sequences in a pass, potentially all in one channel; at most 5/s sustained per process under the configured loop, with an immediate burst of up to 50. Replica count is not bounded by this code. |
| Channel call end/delete | One active call per channel; append only on actual archive/delete; new-call start route has a per-account 20/hour budget | One root-change sequence per successful archival or deletion, plus a separately materialized call-ended activity. Existing record deletion has no time limiter. The start budget is not a per-channel cap. |
| Timeline activity materialization | One source event at a time per consumer; no numeric batch length or per-channel time cap in persistence | A participant event can contain many activities for one channel. One transaction allocates a sequence for every selected activity; replay deliberately allocates again. |

## Agent presentation is structurally coalesced

The fold compares the projected reply shape before emitting `Progressed`
([lifecycle.rs:97](../../folds/agent_fold/src/domain/lifecycle.rs#L97)); unfinished
prose is deliberately absent
([lifecycle.rs:52](../../folds/agent_fold/src/domain/lifecycle.rs#L52)). The
presenter's `shape` includes content only for sealed segments, so changes to
steps inside an open segment do not force a message rewrite
([presenter.rs:89](../../agent_harness/src/domain/presenter.rs#L89)). A segmented
reply becomes postable after its passage is complete
([presenter.rs:39](../../agent_harness/src/domain/presenter.rs#L39)).

The harness suppresses unchanged turn shapes and requires `ready` plus changed
shape for segmented replies
([present.rs:171](../../agent_harness/src/domain/service/present.rs#L171)). It
then awaits each changed message's presentation
([present.rs:218](../../agent_harness/src/domain/service/present.rs#L218)); final
presentation also skips unchanged non-final messages
([present.rs:282](../../agent_harness/src/domain/service/present.rs#L282)). The
announcer uses an idempotent post and skips a patch when content is already
equal or the message was deleted
([channel_announcer.rs:583](../../agent_harness/src/outbound/channel_announcer.rs#L583)).
Thus rapid token streaming into one unfinished passage does not mean rapid
channel writes. A stream of distinct completed passages or changes to sealed
segments still has no enforced interval between channel writes.

Commands are serialized by a worker keyed by **session**, using an unbounded
command channel
([queue.rs:139](../../agent_harness/src/domain/service/queue.rs#L139)); this does
not cap all sessions in one channel. The 50-action queue cap is a count of
queued actions per session, not a channel write-rate limit
([domain/queue.rs:45](../../agent_harness/src/domain/queue.rs#L45)).

The apparent 1,500 ms / 50 ms throttle is for durable **agent-session log**
flushes, with an additional 256-frame flush trigger
([service.rs:1811](../../agent_session/src/domain/service.rs#L1811)). It cannot
be used as a 0.67/s or 20/s channel-message bound: the fold runs before buffering
([service.rs:2000](../../agent_session/src/domain/service.rs#L2000)), its signals
are returned on the append
([service.rs:2143](../../agent_session/src/domain/service.rs#L2143)), and the
actor immediately forwards those signals to the turn observer
([actors.rs:763](../../agent_session/src/domain/session/actors.rs#L763)). There
is no sleep, timer, or rate limiter on that forwarding path.

## Bots and direct message requests

The message router exposes create/edit/delete/react/thread writes with no
rate-limit layer
([axum_router.rs:54](../src/inbound/axum_router.rs#L54)); create directly awaits
the authorized service post
([axum_router.rs:239](../src/inbound/axum_router.rs#L239)). The comment tool can
also post a channel reply through the same service
([comment.rs:91](../src/inbound/toolset/comment.rs#L91)). These are programmatic
writers as well as UI writers; no assumption about human typing speed bounds
them.

The external bot webhook router has no rate limiter
([channel_webhook_router.rs:161](../../bots/src/inbound/channel_webhook_router.rs#L161)).
Every accepted request posts a fresh root with no supplied id or nonce
([channel_webhook_router.rs:278](../../bots/src/inbound/channel_webhook_router.rs#L278)).
The service mounts that router directly
([api.rs:418](../../../services/document_storage_service/src/api.rs#L418)); its
outer application layers are tracing, version validation, CORS, and compression,
not a channel request-rate limit
([api.rs:58](../../../services/document_storage_service/src/api.rs#L58)). This
does not establish anything about external load balancer limits or deployed
traffic; neither supplies a code-enforced per-channel bound here.

The built-in response handler posts once, awaits the responder, then patches
once
([service.rs:614](../../channel_bots/src/domain/service.rs#L614),
[service.rs:636](../../channel_bots/src/domain/service.rs#L636),
[service.rs:658](../../channel_bots/src/domain/service.rs#L658)). The responder
collects all streamed chunks before returning
([agent_loop_responder.rs:63](../../channel_bots/src/outbound/agent_loop_responder.rs#L63));
it does not patch for each chunk. However, each trigger candidate runs in its
own spawned task from an unbounded receiver
([bot_trigger_router.rs:87](../../channel_bots/src/inbound/bot_trigger_router.rs#L87)).
AI admission checks do not make this path a per-channel request-rate limiter.

## Imports and repair bursts

Historical bounds are explicitly validated at 500 messages and 4 MiB
([historical.rs:13](../src/domain/historical.rs#L13),
[historical.rs:110](../src/domain/historical.rs#L110)). Each nonempty batch adds
one reset in its savepoint
([historical.rs:107](../src/outbound/pg_message_repo/historical.rs#L107)), and
the import composition commits that batch with its checkpoint
([channel_sink.rs:186](../../../services/slack_import_worker/src/composition/channel_sink.rs#L186)).
The importer awaits a flush whenever its batch is full and proceeds directly
to the next records
([importer.rs:199](../../slack_integration/src/domain/importer.rs#L199)).

Each worker process permits one or two import lanes
([worker.rs:34](../../slack_integration/src/inbound/worker.rs#L34),
[worker.rs:65](../../slack_integration/src/inbound/worker.rs#L65)); this bounds
concurrency per process, not transactions/s, replica count, or aggregate channel
demand. The import notifier's two-second throttle is only for requester progress
notifications
([gateway_notifier.rs:25](../../slack_integration/src/outbound/gateway_notifier.rs#L25));
it does not pace persistence.

Reference maintenance requests a page of 50
([maintenance.rs:10](../../slack_integration/src/domain/maintenance.rs#L10),
[maintenance.rs:70](../../slack_integration/src/domain/maintenance.rs#L70)). The
worker repair adapter also clamps the loop to 50 and commits every attempt
separately
([reference_reconciliation.rs:37](../../../services/slack_import_worker/src/composition/reference_reconciliation.rs#L37),
[reference_reconciliation.rs:75](../../../services/slack_import_worker/src/composition/reference_reconciliation.rs#L75)).
Only an actual changed body appends a message sequence
([historical.rs:68](../src/outbound/pg_message_repo/historical.rs#L68)). The
maintenance loop sleeps 10 seconds **after** a completed pass
([worker.rs:47](../../slack_integration/src/inbound/worker.rs#L47),
[worker.rs:220](../../slack_integration/src/inbound/worker.rs#L220)). The 5/s
figure is therefore a long-run per-process upper bound for this path, not a
short-window bound: its 50 operations can arrive back-to-back.

## Call lifecycle

Call creation uses `ON CONFLICT (channel_id) DO NOTHING`, enforcing one active
call per channel
([pg_call_repo.rs:507](../../call/src/outbound/pg_call_repo.rs#L507)). Archival
locks the live call row first
([lifecycle.rs:20](../../call/src/outbound/pg_call_repo/lifecycle.rs#L20)), removes
that live call, then adds one channel root change before commit
([lifecycle.rs:228](../../call/src/outbound/pg_call_repo/lifecycle.rs#L228)). A
replayed completion cannot archive the same live call again. Live-call and
record deletion only append when the delete actually removed a row
([pg_call_repo.rs:1061](../../call/src/outbound/pg_call_repo.rs#L1061),
[pg_call_repo.rs:2264](../../call/src/outbound/pg_call_repo.rs#L2264)). Participant
and transcript updates do not individually append channel changes here.

The service wires a 20-starts/hour **account** budget
([server.rs:914](../../../services/document_storage_service/src/server.rs#L914),
[axum_router.rs:76](../../call/src/inbound/axum_router.rs#L76)), checked by the
new-call start path
([service.rs:1177](../../call/src/domain/service.rs#L1177)). It is not a limit
on deleting previously archived records, not a channel-keyed limit, and not a
minimum call duration. A completion also produces one channel `CallEnded`
activity through the separate materializer
([activity.rs:96](../../call/src/domain/activity.rs#L96)); call-started activity
is excluded from the channel timeline selection
([ports.rs:670](../src/domain/ports.rs#L670)).

## Activity batches

Selected timeline activities are inserted and sequenced in one transaction
([persistence.rs:48](../../../services/document_storage_service/src/service/activity/persistence.rs#L48)).
The batch helper groups by channel, increments each channel counter by its
selected activity count, then inserts each log row
([append.rs:59](../../channel_change_db_utils/src/append.rs#L59)). Duplicate
activity identities intentionally receive a fresh sequence on replay
([append.rs:40](../../channel_change_db_utils/src/append.rs#L40)).

Participant changes yield one activity per participant
([activity.rs:106](../../channels/src/domain/activity.rs#L106)). The add request
is a set without a numeric member-count validation
([models.rs:867](../../channels/src/domain/models.rs#L867)); the domain loops
over that set and dispatches the full recipient list
([service.rs:556](../../channels/src/domain/service.rs#L556)). The persistence
adapter likewise has no numeric activity-batch limit. Transport/body-size and
available resources are finite, but these are not a fixed per-channel rate or
activity-count bound in this code.

The activity consumer awaits one source event before the next
([kafka_consumer.rs:111](../../activity/src/inbound/kafka_consumer.rs#L111)), and
the materializer persists the full decoded batch at once
([materializer.rs:25](../../activity/src/domain/materializer.rs#L25)). This is
per-consumer serialization, without a timer or an aggregate channel cap. A
single large participant event can exceed 200 sequence rows in one commit; its
counter occupancy and log insertion cost depend on batch size. It must not be
modeled as 200 independent 5 ms counter acquisitions.

This investigation changed no production code and ran no Cargo or database
commands. It identifies enforced source bounds and missing bounds; production
arrival rates and counter-lock occupancy require runtime measurements.
