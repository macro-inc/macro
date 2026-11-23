# Email backend architecture

The email backend separates HTTP and queue delivery from use-case policy and
infrastructure. The [frontend architecture](email.md) describes the view,
composer, and rendering boundaries.

## Ownership

| Layer | Location | Responsibility |
| --- | --- | --- |
| Inbound | [HTTP API](../../services/email_service/src/api.rs), [queue workers](../../services/email_service/src/pubsub/mod.rs), [email routes and tools](../../crates/email/src/inbound.rs) | Extract identity and requests, decode messages, call a domain service, render errors, acknowledge or retain deliveries. |
| Domain | [email domain](../../crates/email/src/domain.rs) | Authorization and workflow decisions, retry/disposition policy, state transitions, and ports for effects. |
| Outbound | [service adapters](../../services/email_service/src/outbound.rs), [email adapters](../../crates/email/src/outbound.rs) | Implement ports using PostgreSQL, provider APIs, Redis, queues, storage and notifications. |
| SQL access | [email_db_client](../../crates/email_db_client/AGENTS.md) | Existing statements, relational predicates, locks, and legacy storage helpers that remain to be separated. |
| Composition | [API composition](../../services/email_service/src/composition/api.rs), [shared composition](../../services/email_service/src/composition.rs), [worker types](../../services/email_service/src/composition/workers.rs) | Build clients and adapters, then inject them into services. Worker-specific composition stays beside each worker in `worker::context`. |

HTTP handlers obtain identity or typed access receipts at the edge. The domain
checks use-case permissions; adapters execute the requested effects. The service
and database crates still contain legacy workflow helpers, listed below, so their
directory names alone do not establish that every boundary is complete.

## Contexts and startup

`ApiDependencies` supplies the API's raw clients to `api_context`. `ApiContext`
retains composed services, authentication/router states, configuration and the
internal API key. Correlation's database/JWT wiring and invitation repository
composition happen at startup. Some concrete generic service aliases remain in
`api/context.rs`; they describe composition and do not run queries.

Every queue-worker context contains its service and `sqs_worker` receive/ack
handle. There is no shared `PubSubContext`. `BackfillWorkerEffects` and
`InboxSyncEffects` each retain only their own outbound dependencies; the CRM
adapter, retry flag and notification feature flag have their own owners.

The scheduled worker builds `ScheduledDeliveryAdapter`, forwarded-attachment
support and `ScheduledDeliveryService` once in `scheduled::worker::context`.
Each delivery calls that service. Claims, message state and transaction lifetimes
remain per delivery; composing a service once does not hold a database transaction
open between messages.

Keep connection-opening calls in their startup order when changing wiring.
Preserve the listener's task boundaries, cancellation, trace adoption,
acknowledgement and visibility renewal. Backfill's visibility heartbeat remains
around its operation; link manager's visibility-renewal wrapper remains around
each delivery. Those are transport lifecycles, distinct from domain retry policy.

## IMAP integration

The [private engine architecture](imap-engine.md) covers protocol, credential,
connection ownership and deployment boundaries.

IMAP uses the existing durable folder-stream, reconciliation, command, draft
and projection workflows. Protocol workers bind `PgMailboxSync` to one provider:
an Outlook gateway can never claim IMAP work. Projection uses one shared claimer
across providers and routes attachment reads through `ProviderAttachmentBytes`
using the current link provider. Gmail's legacy history ingestion stays separate.
IMAP skips OAuth token acquisition,
Graph watches, address-book streams and calendar grants. The engine posts committed
change or credential-failure hints to `/internal/imap/notifications`; the domain
ignores stale generations, wakes folder work, and records reconnect state once.
Periodic polling recovers lost hints.

The projection claim locks at most 64 due rows, then checks unfinished heads in
a fresh READ COMMITTED statement. This preserves FIFO per serialized producer
without losing a concurrent finish's successor wake. Local blocking and real
retry times remain separate; finishes serialize per link and wake one successor
in their transaction and again after commit to catch a concurrent insert. The
post-commit wake is best effort: its failure is logged while the committed
finish stays successful. Wakes write only when clearing a deferral. The
backstop covers an interruption between those transactions and old binaries.
Inactive work parks outside the due index. Catalog, folder/live streams and
reconciliation use bounded 64-row due windows followed by a fresh-snapshot claim;
independent folders and messages have no per-mailbox FIFO floor. Exact indexed
eligibility includes the lease deadline, real due time and provider retry floor.
A bounded maintenance step relabels legacy reconciliation routing to the link's
provider in the claim itself, without a background repair or completion gate. A legacy mislabelled due prefix
can delay Outlook reconciliation once after deploy: the local synthetic
measurement is about 17–18 seconds per 100k rows. Hosted dev has zero such rows;
production is unmeasured and requires explicit authorization to count. Fresh renewals
read the lease fence without rewriting its indexed expiry. Sync claims take
no fleet-wide advisory lock: live work is first per claimer, with a momentary
inversion across claimers. A locked 64-row live window can divert concurrent
claims to imports for its short transaction, more readily than main's one-row
lock. Mutation claims serialize per provider,
with Outlook alone retaining the old key first for rolling compatibility
until the rollback baseline is retired (`mac-imap-smtp.89`). Initially
ineligible due rows also require a one-time bounded parking drain; hosted dev
has zero in all five work classes. Production counts remain unmeasured.

The parked-work recovery sweep visits parked links rather than their backlogs,
using one next-link index probe per family and one shared cursor. Its 64-row
page shares quota among projection, streams and reconciliation, then borrows
unused room once; this guarantees room for each family with at most six updates.
New activation and recovery paths clear bounded pages immediately; old-binary
link changes converge through the five-minute sweep.

The email domain's `ImapConnectionService` accepts only the actor's independently
verified sign-in address. Logging in to an arbitrary mail server does not prove
control of an email address. Verification and host confirmation run in the
internal engine; the public API derives the owner from authentication. A durable
request-id reservation owns an inactive provisional link before engine promotion.
Interactive requests and recovery share a five-minute per-attempt nonce lease.
Recovery locks one due attempt at a time through the indexed effective deadline,
commits before the bounded engine RPC, and handles at most 32 attempts per cycle.
A fresh reservation stays out of recovery for two minutes. Activation,
abandonment and deferral require the live nonce; completed receipts remain
replayable without probing credentials or recreating a disconnected inbox.
Completed receipts live with their owning user for replay; they map to infinite
eligibility and stay outside the finite-deadline recovery index.
A lease miss is re-read: completed returns the receipt, in-flight is retryable.

Transient failures defer by one quarter of the attempt's database age, clamped
to one through 30 minutes. Proven invalid, forbidden, missing or changed engine
attempts and credential rejection are terminal. Engine verification expiry
rejects an unconsumed token while preserving consumed-token replay. An HTTP
401 from internal authentication proves nothing about consumption: the client
logs an auth failure distinctly and recovery defers it. Attempts still unresolved
after 24 hours expire with a warning and an explicit span field. Each failure
is settled independently, so an old poisoned prefix cannot hide healthy work.
The reconnect retry-floor lookup keeps its original maximum over all IMAP streams.
A partial `(link_id, generation, provider_retry_at)` index includes only IMAP
rows with a retry time. The original query narrows through this index to
the link, generation and future-wait range rather than scanning the stream
table.
No passwords or database connections are retained across engine IO. Gmail, Outlook and IMAP
initialization serialize address collisions through the same advisory lock.

`enable-imap-connections` is the single user-scoped IMAP enrollment flag for
suggestion, discovery, verification and connection requests. Established IMAP
sync and authorized sends, moves and deletes have no PostHog polling or runtime
rollout snapshot. Ownership, active/reauth state, generation and lease fences,
and explicit pause/disconnect/delete controls continue to apply. Uncertain send
outcomes remain observable without resubmission. Outlook's rollout is separate.

The IMAP gateway adapts the internal engine's stable message ids and journal
positions to the mailbox ports. It decodes MIME, sanitizes HTML, exposes decoded
attachments and calendar parts, and retains independent Sent provenance. Local
versioned drafts use the existing coordinator, scheduled delivery and attachment
materializer. Opaque upload capabilities contain the owning link id and are never
fetched as user-supplied HTTP URLs. Disconnect records engine credential teardown
as a prerequisite of local inbox purge.

IMAP keywords have no independent server catalog, so Macro keeps their display
names locally and writes assignments with the message command flow. Blocking a
sender is a local intent: reconciliation chooses an existing Junk or Trash folder
and atomically queues a recoverable move with ingestion, never permanent deletion.

## Queue workflows

| Worker | Domain owner | Service adapter |
| --- | --- | --- |
| Gmail operations | [message_labels/gmail_ops](../../crates/email/src/domain/message_labels/gmail_ops.rs): pending-write ordering, partial settlement, retry and terminal outcomes | [message_labels/gmail_ops](../../services/email_service/src/outbound/message_labels/gmail_ops.rs) |
| Inbox sync | [mailbox/inbox_sync](../../crates/email/src/domain/mailbox/inbox_sync.rs): history, catalog, recovery, deletion, upsert and follow-up policy | [inbox_lifecycle/inbox_sync](../../services/email_service/src/outbound/inbox_lifecycle/inbox_sync.rs) |
| Backfill | [backfill_jobs/worker](../../crates/email/src/domain/backfill_jobs/worker.rs): admission, deferral, import, initialization, completion and effect leases | [backfill_jobs/worker](../../services/email_service/src/outbound/backfill_jobs/worker.rs) |
| Link manager | [mailbox/link_manager](../../crates/email/src/domain/mailbox/link_manager.rs): probes, reauthentication recipients and link deletion, on an interactive and a maintenance queue (`LinkManagerMessage::lane`) | [link_manager](../../services/email_service/src/outbound/link_manager.rs) |
| Scheduled delivery | [scheduled_delivery](../../crates/email/src/domain/scheduled_delivery.rs): claims, delivery fences, reconciliation and retained deletion | [scheduled_delivery](../../services/email_service/src/outbound/scheduled_delivery.rs) |
| CRM cleanup | [crm_cleanup](../../crates/email/src/domain/crm_cleanup.rs): jobs, pruning, dispatch, teardown and retry | [crm_cleanup](../../services/email_service/src/outbound/crm_cleanup.rs) |
| Contact-photo upload | [mailbox/contacts/sfs_upload](../../crates/email/src/domain/mailbox/contacts/sfs_upload.rs): mapping reuse, best-effort writes and refresh | [sfs_upload](../../services/email_service/src/outbound/sfs_upload.rs) |
| Stored-file deletion | [attachment_cleanup/sfs_deletion](../../crates/email/src/domain/attachment_cleanup/sfs_deletion.rs): file/row deletion order and already-missing files | [sfs_deletion](../../services/email_service/src/outbound/sfs_deletion.rs) |

Backfill and inbox sync share the domain's catalog, contact and pending-label
rules; inbox sync and link manager share notification-recipient selection.
Backfill's durable publication is a separate
[domain outbox](../../crates/email/src/domain/backfill_jobs/outbox.rs), with the
service's `backfill_outbox` facade retaining polling and cancellation.

## Persistent state

Pending-label folding, fallback restoration, batch validation and catalog policy
live in `domain/message_labels/state.rs`. `PgLabelState` and `PgLabelCatalog`
adapt the caller's transaction or pool to the existing database statements.

Incremental mailbox purge policy lives in `domain/mailbox/link_manager/purge.rs`.
`outbound/mailbox_pg/purge.rs` supplies transaction operations; the statement text
and relational guards remain in `email_db_client::links::delete`.

Scheduled delivery's claim classification, sent-identity adoption and retained
deletion live in `domain/scheduled_delivery/{state,identity,deletion}.rs`.
`outbound/scheduled_delivery_pg.rs` provides the transaction capabilities. Keep
SQL predicates, lock order, savepoints and transaction boundaries intact when
moving Rust policy. Preserve how the domain interprets statement outcomes,
along with error text and tracing contracts, including legacy tracing targets
that name database modules.

## Mechanical guards

The six `email-*` [ast-grep rules](../../rules/ast-grep) check domain and inbound
concrete-I/O references, raw client state, worker runtime I/O, and outbound
dependencies on inbound modules. See the [style guide](../development/style-guide.md#email-backend-boundary-checks)
for validation commands.

The rules retain explicit allowances for tests, worker startup composition,
concrete service type declarations, SQS receive/ack and envelope metadata, and a
few existing data/error types. Three adapter helpers still at old pubsub paths
are allowed by exact name: `cg_refresh_email`,
`complete_transaction_with_processing_error`, and `publish_email_event`.
The rule files contain the complete allowlists; do not replace them with a
whole-worker or whole-client namespace exemption.

These checks inspect syntax, not Rust name resolution or business policy. A
clean scan does not prove that every outbound helper is free of workflow policy.

## Remaining boundaries to review

| Area | Current location and remaining work |
| --- | --- |
| Gmail credential health | [token_source.rs](../../services/email_service/src/outbound/email_api/token_source.rs) still selects health transitions and reauthentication notification behavior around token I/O. |
| Address-book and photo storage | [sync_contacts.rs](../../services/email_service/src/util/sync_contacts.rs) retains cursor recovery, contact filtering, persistence and fan-out orchestration; [contact_photos.rs](../../services/email_service/src/outbound/contact_photos.rs) combines mapping reuse, upload and persistence. |
| Attachment and projection effects | [inbox import effects](../../services/email_service/src/outbound/inbox_lifecycle/inbox_sync/import_effects.rs), [mailbox_projection.rs](../../services/email_service/src/outbound/mailbox_projection.rs) and [upload_attachment.rs](../../services/email_service/src/util/upload_attachment.rs) retain eligibility and multi-effect decisions. |
| Invitation selection and legacy helpers | [invitation_extraction.rs](../../services/email_service/src/outbound/invitation_extraction.rs) selects inline versus attachment parts; [pubsub/util.rs](../../services/email_service/src/pubsub/util.rs) hosts legacy adapter helpers. Calendar refresh recipients are chosen by `calendar_events`' [gateway_refresh.rs](../../crates/calendar_events/src/outbound/gateway_refresh.rs). |
| Legacy database composites | `email_db_client` retains message ingestion/savepoints, label mapping during ingestion, parsed-read assembly, contact normalization and backfill lease/completion helpers. Moving label state, purge and delivery policy did not remove these. |
| Other persistence-adapter decisions | [draft_transfer.rs](../../crates/email/src/outbound/email_pg_repo/draft_transfer.rs), [scheduled.rs](../../crates/email/src/outbound/email_pg_repo/scheduled.rs) and [focus_pg.rs](../../crates/email/src/outbound/focus_pg.rs) still need review of eligibility, authorization and read selection versus atomic storage guards. |
| Adapter composition | [inbox import repository](../../services/email_service/src/outbound/inbox_lifecycle/inbox_sync/import_repository.rs) still constructs email-crate repositories; scheduled delivery embeds a concrete read-receipt repository. Prefer host composition when separating these dependencies. |
| Scheduled content preparation | [scheduled content](../../services/email_service/src/outbound/scheduled_delivery/content.rs) and [Gmail send helpers](../../services/email_service/src/util/gmail/send.rs) retain content selection, attachment reconciliation and provider draft cleanup. |

Review these workflows individually. Preserve codecs, row mapping and atomic SQL
guards where they belong; move use-case decisions through domain ports with
behavioral coverage.

IMAP engine persistence stores folders, message metadata, remote locations, retained
journal entries, drafts, draft attachments and uploads in indexed, link-scoped
`imap_state_entries` rows. Account JSON contains only health and send admission
counters. Individual message and draft operations load selected keys; initial
folder scans use a message-id keyset and incremental scans use journal sequences.
Differential saves update only changed loaded rows under the account lease and
compare-and-swap revision. Health-only saves bypass the index rows entirely.
Upload bytes use `bytea`. Full metadata hydration is
restricted to two concurrent synchronization passes per engine instance.

Organization writes fetch the current headers and flags for one UID, validate the
observed version, and apply a conditional MODSEQ where supported. UIDPLUS COPYUID
updates the exact destination locator after MOVE. When a server omits COPYUID, a
zero-UID destination membership retains the logical identity until the next sync;
reads and writes retry instead of issuing a command against an invented UID.

Folder exclusions preserve the complete catalog, including role ancestry and
retained messages. The provider's `syncEnabled` admission flag is persisted in
`email_mailbox_folders.sync_enabled`; catalog commits create streams only for
enabled folders and retire paused streams without queuing message rechecks.
Re-enabling a folder creates a new stream while retaining its known messages.
