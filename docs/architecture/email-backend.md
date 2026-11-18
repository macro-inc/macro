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

## Queue workflows

| Worker | Domain owner | Service adapter |
| --- | --- | --- |
| Gmail operations | [message_labels/gmail_ops](../../crates/email/src/domain/message_labels/gmail_ops.rs): pending-write ordering, partial settlement, retry and terminal outcomes | [message_labels/gmail_ops](../../services/email_service/src/outbound/message_labels/gmail_ops.rs) |
| Inbox sync | [mailbox/inbox_sync](../../crates/email/src/domain/mailbox/inbox_sync.rs): history, catalog, recovery, deletion, upsert and follow-up policy | [inbox_lifecycle/inbox_sync](../../services/email_service/src/outbound/inbox_lifecycle/inbox_sync.rs) |
| Backfill | [backfill_jobs/worker](../../crates/email/src/domain/backfill_jobs/worker.rs): admission, deferral, import, initialization, completion and effect leases | [backfill_jobs/worker](../../services/email_service/src/outbound/backfill_jobs/worker.rs) |
| Link manager | [mailbox/link_manager](../../crates/email/src/domain/mailbox/link_manager.rs): probes, reauthentication recipients and link deletion | [link_manager](../../services/email_service/src/outbound/link_manager.rs) |
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
| Invitation and calendar refresh selection | [invitation_extraction.rs](../../services/email_service/src/outbound/invitation_extraction.rs) selects inline versus attachment parts; [pubsub/util.rs](../../services/email_service/src/pubsub/util.rs) selects calendar refresh recipients as well as hosting legacy adapter helpers. |
| Legacy database composites | `email_db_client` retains message ingestion/savepoints, label mapping during ingestion, parsed-read assembly, contact normalization and backfill lease/completion helpers. Moving label state, purge and delivery policy did not remove these. |
| Other persistence-adapter decisions | [draft_transfer.rs](../../crates/email/src/outbound/email_pg_repo/draft_transfer.rs), [scheduled.rs](../../crates/email/src/outbound/email_pg_repo/scheduled.rs) and [focus_pg.rs](../../crates/email/src/outbound/focus_pg.rs) still need review of eligibility, authorization and read selection versus atomic storage guards. |
| Adapter composition | [inbox import repository](../../services/email_service/src/outbound/inbox_lifecycle/inbox_sync/import_repository.rs) still constructs email-crate repositories; scheduled delivery embeds a concrete read-receipt repository. Prefer host composition when separating these dependencies. |
| Scheduled content preparation | [scheduled content](../../services/email_service/src/outbound/scheduled_delivery/content.rs) and [Gmail send helpers](../../services/email_service/src/util/gmail/send.rs) retain content selection, attachment reconciliation and provider draft cleanup. |

Review these workflows individually. Preserve codecs, row mapping and atomic SQL
guards where they belong; move use-case decisions through domain ports with
behavioral coverage.
