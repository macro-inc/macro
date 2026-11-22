# email_service

## What it is

Email feature: deployable service hosting Gmail sync, email send/schedule/
draft routes, calendar invitation handling, and contacts/CRM sync, behind
the gateway `/email` prefix.

## Start here

- `api/imap.rs` exposes connection suggestion, discovery and IMAP linking under
  `/email/links`; `outbound/imap_connection.rs` stores retry-safe promotion
  attempts. `outbound/email_api/imap.rs` implements the existing mailbox,
  command, attachment and draft ports through the internal engine client.
  `imap_runtime.rs` resumes interrupted credential-free connection promotions.
  Established IMAP work has no service-wide rollout polling.
  Only a typed engine `SendUnavailable` proves no message-body byte was submitted and
  terminates the draft as failed. Keep generic 503/timeouts uncertain; never
  infer safe resubmission from them or from the presence of a remote draft.

- `src/main.rs` / `src/lib.rs`: entrypoint and `run()`.
- `src/api.rs` + `src/api/context.rs`: HTTP surface and `ApiContext`.
- `src/composition/api.rs`: production API dependencies and service wiring.
  It composes optional activity correlation and the saved-invitation service;
  `ApiContext` holds services, authentication/router states and configuration;
  raw database/provider clients belong to the composed adapters.
  Inject CRM rule discovery into the API EmailPgRepo for selected Team reads;
  the adapter uses the reader's transaction and owns no additional pool.
- `src/composition/workers.rs`: shared worker service aliases and invitation
  extraction composition. Per-worker constructors stay in `worker::context`.
- `src/outbound/message_reads.rs`: query adapter for the email domain's synced
  read service; handlers retain only extraction and HTTP/error rendering.
- `src/outbound/inbox_access.rs`, `inbox_contacts.rs`, `scheduled_drafts.rs`,
  `calendar_disconnect.rs`, and `signature_settings.rs`: adapters for the five
  inbox-scoped use cases; handlers delegate to their email-domain services.
  `outbound/signature_settings/gmail_images.rs` performs mailbox/public image reads;
  source selection and retry handling stay in the signature domain service.
- `src/outbound/gmail_push.rs` and `user_deletion.rs`: adapters for domain-owned
  Gmail push authentication/intake and deleted-user inbox removal. The webhook
  auth feature is selected once in composition; handlers only extract and render.
- `src/outbound/inbox_connection.rs`: adapters for the domain-owned `/email/init`
  flow; transaction boundaries, legacy errors, and token-info HTTP are preserved.
  Scope discovery asks the typed `GoogleOauthTokenInfoUrl`, resolved at startup.
  The transport failure observer and shared HTTP status rule live in `src/api/email/init.rs`.
- `src/outbound/backfill_jobs.rs`: the existing job queries and initialization
  queue send behind the email domain backfill-job service.

- `src/pubsub/`: SQS pubsub workers, one module per concern — `inbox_sync`,
  `link_manager` (Gmail re-subscribe, health checks, inbox deletion),
  `scheduled` (scheduled sends),
  `sfs_uploader`/`sfs_deleter` (attachment storage), `gmail_ops`, `backfill`,
  `crm_cleanup`, `worker_lifecycle`.
  Each worker's `worker::context` builds a service plus its SQS receive/ack handle.
  Backfill and inbox sync have separate outbound effect dependencies; there is
  no shared `PubSubContext`. Scheduled delivery and its forwarded-attachment
  adapter are composed once at startup, with delivery state and transactions
  scoped to each call. Gmail operations compose
  the email domain's `message_labels::gmail_ops` service there; their listener
  only decodes and acknowledges the domain disposition. Settlement transactions,
  Gmail calls, and retry publication are in `outbound/message_labels/gmail_ops.rs`.
  Inbox sync composes `email::domain::mailbox::inbox_sync` with adapters in
  `outbound/inbox_lifecycle/inbox_sync/`. Backfill's domain worker owns
  admission, retry/deferral, listing, thread/message import,
  initialization, completion accounting and leases, metadata, attachment and CRM
  policy, with adapters in `outbound/backfill_jobs/worker/`. Inbox sync's history and upsert
  orchestration also live in the domain; these adapters retain the existing
  journal, invitation, upload, notification and persistence implementations.
  Link manager composes `email::domain::mailbox::link_manager` for delivery
  disposition, probes, reconnect notifications and physical deletion; its
  context holds only the service and receiver. `outbound/link_manager/deletion.rs`
  implements the cleanup capabilities without owning deletion policy.
  Backfill and inbox sync reuse the domain's catalog, contact and pending-label
  rules; inbox sync and link manager share notification-recipient selection.
  Adapters retain the existing atomic writes and savepoints.
  SFS deletion composes `email::domain::attachment_cleanup::sfs_deletion` with
  `outbound/sfs_deletion.rs`; its listener only decodes and acknowledges the
  domain disposition. The domain deletes the file before its database row and
  accepts a file-service 404 as an already completed file deletion.
  SFS uploads compose `email::domain::mailbox::contacts::sfs_upload` with
  `outbound/sfs_upload.rs`; mapping fallback, best-effort writes, and self-contact
  refresh decisions live in the domain. Adapters reuse the existing image
  fetch/upload and gateway helpers with their original spans and failures.
  CRM cleanup composes `email::domain::crm_cleanup` with `outbound/crm_cleanup.rs`;
  the domain owns job state, pruning, dispatch, teardown guards and retry policy.
  Adapters retain the existing SQL and CRM teardown transactions, queue envelope,
  and UTC reads at the same two decision sites.
- `src/backfill_outbox.rs`: cancellation-aware polling facade for the domain's
  durable backfill publication. `outbound/backfill_jobs/outbox.rs` keeps each
  row lock through the queue send and commits the publication marker afterwards.
  CRM publication retains captured incarnation/version/work IDs for modern
  jobs and makes them due again after 15 minutes; legacy publication deletes.
  Conditional acknowledgement cannot delete a newer generation. Rule activation
  remains behind a default-off API flag; workers never initialize consent.
- `src/email_policy_worker.rs`: cancellation-aware source-event poller on the
  backfill pool. The CRM domain bounds raw reverse references before filtering
  active selected policies, atomically scheduling history and system audit.
  A separate cancellation-aware count-preview poller uses the same pool, with
  its own bounded read-only snapshot and no consent initialization. Neither
  creates spans for empty polls; preview work must not delay source events.
- `src/crm_enrichment_worker.rs`: periodic pass that resolves pending CRM
  company directory entries (names/logos) left by binaries without a resolver,
  using the public-homepage `UnfurlCompanyMetadataResolver` wired in
  `pubsub_workers`. It requires no enrichment-provider key or selection flag.
- `src/mailbox_sync_worker.rs`: the Outlook mailbox loops (sync, projections,
  contacts, drafts, commands, settings, watches) and `run_health`, the
  per-minute Outlook health snapshot.
- `src/bin/`: standalone binaries — `pubsub_workers` (the queue consumer
  process), plus one-off backfill/cleanup scripts.

## Scope

- Owns: Gmail/email API routes, email-side calendar invitation handling,
  contacts sync, and all `src/pubsub/` queue consumers listed above.
- Not here: Google Calendar sync itself → `crates/calendar_events`,
  `calendar_service`; scheduled-send and SFS-cleanup *triggering* (cron) →
  `email_scheduled_handler`, `email_sfs_delete_handler`, `email_refresh_handler`
  (this service consumes the queues they publish to).

## Boundaries

- Read the [backend architecture](../../docs/architecture/email-backend.md) for
  ownership, startup composition, guard exceptions and remaining legacy helpers.
- Keep authentication/transport extraction at the edge and use-case authorization
  in the domain. Call services from handlers and delivery processors; preserve
  the listener's cancellation, visibility-renewal and acknowledgement boundaries.
- The `email-*` ast-grep rules guard API/domain/worker I/O and raw client state.
  Concrete service declarations and `worker::context` are composition; they are
  not a reason to allow client calls in delivery loops.

## Recipes

- Add an email API route: `src/api/email.rs` (or `src/api/gmail.rs`,
  `src/api/calendar_invitations.rs`, `src/api/calendar_event_forward.rs`) →
  `src/api/context.rs` → `src/api/swagger.rs`.
- Add a pubsub consumer: new module under `src/pubsub/` → wire into
  `src/pubsub/mod.rs` and the `pubsub_workers` binary.
- Add a backfill step in `email::domain::backfill_jobs::worker`; wire its leaf
  capabilities in `outbound/backfill_jobs/worker/` and its durable publication
  in `email::domain::backfill_jobs::outbox`.

## Checks

- `cargo test -p email_service` (`SQLX_OFFLINE` unset; the `label_write_sim`
  tests also need Redis, at `REDIS_URI` or `redis://127.0.0.1:6379`).
- The ignored provider-repair scale test `ten_million_legacy_rows_are_repaired_in_bounded_committed_pages`
  runs with `cargo test -p email_service ten_million_legacy_rows --lib -- --ignored --nocapture`.
  It requires an owned scratch PostgreSQL server and creates its own SQLx test
  database; allow its storage and runtime. Run `resumes_ten_million_repaired_rows_after_validation_backoff`
  separately with `DATABASE_URL` set to the preserved `_sqlx_test_*` fixture on
  loopback. Never point either test at shared or hosted databases; set the URL
  inside the devshell command.
- `just check` from this directory runs `cargo check` with `SQLX_OFFLINE=true`.
  Run root `just check` as well for the shared code-rule and privacy checks.
  Changes to the boundary rules also run their
  [native ast-grep tests](../../docs/development/style-guide.md#email-backend-boundary-checks).
- Local SQS: `just create-localstack` / `create-queues` before running
  `pubsub_workers` locally; queue names are in the `justfile`.

## Gotchas

- A program (`macro_authorization::is_program_run`) reads Macro's own sign-in emails redacted: every API response passes `rewrite_program_json` with `models_email::sign_in_email::hide_sign_in_emails`, and `GET /email/messages/{id}/eml` refuses one with 403. A person reads them whole.
- The API's server spans come from `macro_tower_layers`
  (`api::traced`). tower-http's default `TraceLayer` span is DEBUG, below the
  exporter's INFO filter, so an API wrapped in it sends no server spans.
- `models_email`'s `Link`, `BlockSenderPayload` and `UnblockSenderPayload`
  `Debug` print only opaque fields. Keep addresses,
  `macro_id`, contact emails and whole messages out of span fields: skip them
  in `#[tracing::instrument]` and record `link_id` or provider ids instead.

- Provider-sync deletions deferred by active sends publish no deletion event; scheduled recovery reconciles the retained marker before trying to claim delivery.
- Scheduled delivery calls the email domain for durable claims, completion fences, provider identity adoption and retained deletions; its PostgreSQL capabilities are wired by `email::outbound::scheduled_delivery_pg`. The worker adapter retains provider I/O, event publication and attachment cleanup.

- Draft edit routes carry `draft_generation` from the editing lifetime, including attachments, deletion, transfer, and schedules; regenerate OpenAPI clients when this contract changes.

- The Gmail delivery adapter freezes approved upload/provider-file IDs before
  loading bytes through the authorized reader; Outlook uses its own coordinator.

- Forwarded attachments use the source inbox's provider credentials; the email
  domain rechecks the scheduled actor's access before cross-inbox downloads.
- Macro's own digest emails are filtered out of Signal/email notifications
  (#7039) — don't reintroduce a path that notifies on our own sends.
- Remote signature images and contact photos are fetched only through
  `util/process_pre_insert/sfs_map/public_http.rs`, whose resolver and
  redirect policy refuse non-public addresses. Don't fetch them with another
  client.
- Long attachment names are truncated to the DSS limit before upload (#7893);
  don't remove that truncation when touching `util/upload_attachment.rs`.
- A presigned upload URL's query holds AWS credentials and a session token,
  and the `UploadAttachmentError`s of every attachment upload are logged. Keep
  them free of it: strip reqwest errors with `without_url()`, and from an S3
  error body keep only its `<Code>` (`s3_error_code`), since a
  `SignatureDoesNotMatch` body echoes the signed request.
- An attachment's file type comes from a Macro file type's extension on its
  filename (`FileType::split_suffix_match`, as uploads use) unless its MIME
  type names a different Macro file type, and from the MIME type without such
  an extension: mail clients send many files as `application/octet-stream`.
  The Gmail attachment backfill calls the same `determine_file_metadata`; keep
  the two on it.
- Scheduled Gmail sends recheck forwarded source inbox access before resolving
  attachment bytes through the provider-aware reader.
- Preserve the calendar domain's `team_ooo_changed` hint when forwarding a
  calendar refresh so unrelated invitation updates retain teammates' OOO rows.
- The Outlook sync loop (`mailbox_sync_worker::run`) claims a due folder page
  before every message read. An import keeps its folders' next pages due, so
  claiming pages once per cycle would leave a folder with new mail behind
  every worker's whole cycle of queued messages. A cycle ends when no message
  is due, so folder catalogs are checked again before more pages are read.
- Outlook sync flags are PostHog flags for the service context
  `outlook-mailbox-sync`, each read about once a minute into a domain switch
  by `outlook_flags::run` (one `outlook.feature_flag.refresh` span per read,
  `feature_flag.key` names it). `pubsub_workers` reads
  `enable-outlook-import-live-pass` into the sync's `LiveImportPass`:
  newest-first imports and the live pass beside each folder's import round
  ([runbook](../../docs/runbooks/outlook-sync.md#new-mail-during-an-import)).
  The API server reads `enable-outlook-notified-message-reads` into the
  webhook's `NotifiedMessageReads`: a notification's message is queued as
  live work ([runbook](../../docs/runbooks/outlook-sync.md#reading-notified-messages)).
  Without a `POSTHOG_API_KEY`, or while a read fails, a flag is off and warns
  once; a local stack's placeholder key reads off.
- `OUTLOOK_IMPORTS_PAUSED` (read at startup) makes the Outlook sync loop claim
  only live message work; import rows wait and live changes keep importing.
  `src/bin/reimport_outlook_folders` re-imports folders whose delta round
  started at an older reader revision ([runbook](../../docs/runbooks/outlook-folder-reimport.md)).
- Spawn `run_transfers` regardless of the Outlook flags. Gmail inbox moves
  finish there; with writes off it pauses only the Outlook retire step.
- Every Graph call takes a permit from `RedisMicrosoftRequestGate`
  (`email_api_client`). `pubsub_workers` builds the Outlook sync's import
  gateway with `RequestBudget::Import`; every other Microsoft caller,
  calendar_service included, uses `RequestBudget::Live`.
- Every `GmailApi` call takes a permit from `RedisGmailRequestGate`
  (`outbound/email_api/gmail_gate.rs`): per mailbox it caps requests in
  flight and quota units per window, and pauses after a Gmail 429 (live work
  for a second, backfill for at least 10 s). A "Too many concurrent requests"
  429 also lowers that mailbox's in-flight cap, which then rises by one a
  minute back to five; backfill gets what the cap leaves above two. It fails
  closed, so a Redis outage surfaces as local rate limits. Consumers must
  requeue or redeliver a rate-limited message, never drop it. Up to twelve
  refused backfill requests per mailbox wait up to 20 s for room so backfill's
  slots don't idle; the rest are sent back as new, delayed messages
  (`email::domain::backfill_jobs::worker`), because waiting out the visibility
  timeout would spend the queue's 20 deliveries.
  Inbox sync releases the upload claims of a refused attachment fetch and
  requeues the upsert, because a claimed attachment is never offered again.
- An attachment row can be deleted after it is claimed: a Gmail draft gets a
  new message id on every save, and deleting the old revision cascades its
  attachments. DSS then answers the import with a coded 404
  (`EMAIL_ATTACHMENT_NOT_FOUND`), surfaced as
  `UploadAttachmentError::AttachmentDeleted`. Every caller treats it as nothing
  left to do: skip, no retry, no claim to release. The newer revision imports
  its own rows.
- BackfillThread reads a whole thread with one Gmail `threads.get` and writes
  the thread row and all of its messages in one transaction
  (`insert_backfilled_thread`), so a failed write leaves nothing for a retry
  to skip. Each message has its own savepoint: one whose data can never be
  stored ([`database_error::is_unstorable`](src/outbound/backfill_jobs/worker/database_error.rs))
  is skipped and logged, and the rest of the thread commits. The CRM fan-out is
  enqueued after the write slot is taken and before the write: after the commit
  nothing in the handler may request a
  retry, because a retry would find the thread and skip it, and an operation
  deferred for a busy slot must not repeat the fan-out. Invitation and attachment fan-outs only log their
  failures, and the metadata step is enqueued last. BackfillMessage only drains
  operations enqueued before thread writes.
- Backfill keeps a message hidden while its operation runs
  (`process::keep_invisible`, a 20 s heartbeat restoring the queue's 60 s
  visibility timeout). Without it, a slow thread is delivered to a second
  worker, which counts the written thread again.
- Each backfill thread write, and each BackfillMessage write still draining,
  holds one of twenty fleet-wide Redis write slots
  (`util/redis/backfill_write_slots.rs`), however many workers and tasks run,
  so a large backfill can't queue enough writers on the primary to slow every
  other query. A write waits up to 10 s for a slot and is then deferred like a
  rate limit; Redis failing to decide also defers it. Run the write through
  `BackfillWriteSlot::hold`, which renews the 120 s lease while the write runs,
  so a stalled write can't lose its slot to another writer. Live inbox
  sync writes take no slot. Keep new bulk backfill writes behind the same slots.
- Each CRM contact population holds one of four per-team Redis slots
  (`try_acquire_crm_population_slot`), so one team's consent backfill can't
  hold a database connection per worker. It never waits for one: a refused
  population (all four taken, as when the team is paused by filling its slot
  set) is deferred 10 to 15 minutes (`admit_crm_slot`), so a paused team holds
  no backfill worker. A population that timed out on a CRM lock
  (`CrmError::Contended`) is deferred like a busy write.
- `gmail_ops` workers decode both label write forms: single-message
  `ModifyMessageLabels` and `ModifyMessageLabelsBatch` (up to 1,000 messages).
  From ten messages up a batch is one `batchModify`, which a permanent failure
  reverts as a whole. Below that, gmail_ops sends one `messages.modify` per
  message (5 units each against a flat 50), checks the message's turn just
  before each, and settles each message as Gmail answers: a permanent
  rejection reverts only the messages Gmail hasn't accepted, and a resumed
  older write skips messages a newer write took over. Producers send the
  batch form only with `GMAIL_LABEL_WRITE_BATCHES_ENABLED` (here and in
  `document_storage_service`, default off), because workers released before
  it delete batches as undecodable. Rollout: deploy with the switch off; once
  every `pubsub_workers` task runs that release, set it to `true` in the
  `email-service` and `document-storage` Doppler projects (dev, then prd) and
  redeploy both services. Before rolling workers back past that release, turn
  it off and let the gmail-ops queues drain. Retire the single-message form
  only after every producer sends batches.
- Message-label adapters call `email::domain::message_labels::state` with
  `PgLabelState` for transaction statements and `PgLabelCatalog` for pool reads
  and catalog statements; preserve the surrounding transaction and lock scope.
- Gmail label writes leave a marker in `email_gmail_pending_label_writes`.
  Inbox sync keeps the local state of a label marked before or after it reads
  Gmail (`email::domain::mailbox::inbox_sync`); a re-sync or recovery
  backfill of a stored message also keeps labels Gmail's answer agrees with
  the pre-fetch snapshot on. gmail_ops sends only messages its write is the
  newest on, and sends them before an operation with a newer write still on
  its way (whatever its id) waits in the retry queue
  (`NewerLabelWritePending`), so bulk writes that are each newer on one of the
  other's messages don't wait on each other. A waiting message sends if the
  newer write is rejected. A permanent failure gives up the write's unaccepted
  and waiting messages and puts back what the newest older write still on its
  way, or the state before the write, says; an expired marker no longer
  counts. Both label write forms carry the write's `pendingWriteId`; with
  batches off, each message's operation settles only that message's markers.
  Markers expire after 12 hours, which must outlast an operation's redelivery
  through the gmail_ops queues.
- `pubsub::label_write_sim` wires one mailbox to the production label-write,
  gmail_ops and inbox sync code with fake Gmail and SQS. Add a test there for a
  new race between writes and syncs; its ignored `randomized_shard_*` tests run
  the seeded simulation (`SIM_SEEDS`, `SIM_OVERLAP`, `SIM_BATCHES`, see
  `sim/test.rs`). Scenarios run in both label write forms (`scenario!`).
  Keep bare unauthenticated `GET /` listener probes out of the fake Gmail
  request log; retain authenticated, query-bearing, body-bearing and provider requests.
- Local stacks run debug workers on tokio's 2 MiB worker stacks, where every
  awaited future takes its own stack slot. Pass a Gmail call through a helper
  as a `BoxFuture`, and box an operation the dispatch awaits in several arms;
  a `label_write_sim` test runs the label paths on 1.5 MiB worker stacks.
- Inbox sync and gmail_ops add the operation as context on a failure's error
  (`prefix_error_source`), so logs and spans keep its whole chain, and their
  failure spans record the chain's SQLSTATE as `db.response.status_code`
  (`pubsub::util::sqlstate`).
- gmail_ops moves transient Gmail failures to the retry queue like rate limits;
  the primary queue dead-letters after three receives.
- Every contacts producer (address-book sync, inbox sync, the backfill's sent
  seed and contacts step, the Outlook projection, `bin/backfill_contacts`)
  publishes through `composition::ContactsProducer`: the legacy
  owner-to-contact connections always, then `record_inbox_contacts` with the
  inbox (`outbound/inbox_source.rs`: owner, link id, provider), which the
  contacts crate's `ListWritesGate` sends only while the PostHog flag
  `contacts-list-writes` is on (read with `POSTHOG_API_KEY`; on in a local
  stack). A disconnect sends `directory_changed` for the owner after the purge,
  through the same gate. Keep both sends until the legacy graph is retired.
- Header addresses that Gmail accepts can fail `MacroUserIdStr::try_from_email`.
  Skip the bad address with a WARN that omits it (the parse error echoes it)
  instead of failing the step; see
  `email::domain::mailbox::inbox_sync::build_contact_connections`.
- Link-manager messages go to one of two queues by
  `models_email`'s `LinkManagerMessage::lane(sender)`: the interactive
  `LinkManagerQueue` (a person's removal, account deletion, reauth notices,
  health checks a person asked for) or `LinkMaintenanceQueue` (the refresh handler's
  refreshes, health polls and removal sweeps). Each producer names its
  `LinkManagerSender`. A sweep removal's purge is re-sent by the lifecycle's
  effect publisher, so unused and inactive removals keep the maintenance lane
  by their reason; a new message kind or reason decides its lane there. Each
  task runs one consumer per lane; `email.link_manager.message` records `lane`,
  `kind` and `queue_wait_ms` (since SQS accepted the message).
- The `link_manager` worker receives one message at a time and renews its
  visibility while processing. Don't raise its receive batch: messages queued
  behind a long mailbox purge would be redelivered and purged twice. A
  deletion whose inbox stays locked past the lock timeout
  (`InboxLifecycleError::Contended`) runs again in the same delivery, up to six
  times 20 s apart, before it goes back to the queue, so a short contention
  does not spend a receive. Contention that outlasts all six attempts on five
  deliveries still dead-letters the deletion.
  `PurgePacing` (`email::domain::mailbox::link_manager::purge`) sets the purge's write rate.
  Refresh and HealthCheck probes are capped at 240 s so a stalled probe is
  redelivered instead of held in flight. A probe returns an error, and so is
  redelivered toward the DLQ, only for transient failures. An `AuthRequired`
  watch renewal retries once with a fresh token so the token source can set
  `needs_reauth`, and finishes once that flag is stored.
- `run_health` runs in every `pubsub_workers` task: each flushes its in-memory
  Outlook import counts every minute, and the task that wins the Redis key
  `outlook:health_snapshot` logs one "outlook mailbox health" line per Outlook
  mailbox. Its fields, the `outlook.sync.*`, `outlook.graph_request` and
  `outlook.token.acquire` spans and the import lifecycle logs are read by the
  Outlook sync monitors in `infra/stacks/monitoring`; rename them only
  together. Loops whose domain service logs its own deferrals use `reported`,
  the others `record`, which logs gate refusals at DEBUG.
- `GET /internal/recent_messages/{user_id}` reads the user's own syncing
  inboxes straight from Gmail and Outlook (`outbound/recent_inbox.rs`), not
  the synced mailbox, so it answers before a backfill finishes. Every call
  spends live provider quota; Gmail reads three messages at a time to stay
  under the gate's live cap. Don't record message content or addresses on
  its spans.
- Connecting an inbox writes its `email_links` row, which a CRM contact
  population share-locks for its whole transaction. The connect transactions
  (`outbound/inbox_connection/transactions.rs`, `outbound/mailbox_init.rs`)
  open with `outbound::link_lock::begin`, a 5 s `lock_timeout`, and a lock
  timeout is `InitializationError::Contended`. `/email/init` answers it 503,
  never 409: web clients released before the coded 409s read any 409 from
  that route as a sharing conflict to confirm.
  `set_credential_owner` keeps waiting, because it follows the Google grant's
  relocation and a give-up would leave the shared inbox's tokens failing.
  The token-health writes (`email_db_client::links::update::{set,clear}_link_needs_reauth`)
  give up after 5 s too and are written again on the next token fetch.
- Every 409 from `/email/init` is an `InitConflictResponse` tagged by `code`;
  clients offer to share the inbox only for `SHARED_INBOX_CONFLICT`, whose
  fields stay at the top level for those older clients. A new 409 outcome
  gets its own variant, never a plain-text body.
- To run against `crates/gmail_emulator` instead of Google, set the
  `OVERRIDE_*` variables its AGENTS.md lists; a local stack with no real
  Google client sets them itself. Without
  `OVERRIDE_GOOGLE_OAUTH_TOKEN_INFO_URL`, an `/email/init` with no OAuth
  attempt asks Google about the emulator's token: discovery fails with a
  warning, no calendar grant is recorded and calendar sync never starts,
  though init succeeds.
- `GET /opens/{token}` is public and must return the same uncacheable GIF for
  every token. Gmail sends add the pixel only to the provider copy in
  `outbound/scheduled_delivery.rs`; Outlook adds it through the materializer
  wrapper in the `pubsub_workers` binary. Pixels use `EmailServiceUrl`, so the
  local Docker stack embeds an in-network host recipients cannot load.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `new-service`

- Validate optional agent correlation at the HTTP boundary; delayed Gmail completion restores it from the scheduled-message row.

- Durable mailbox refresh effects propagate gateway handoff failures for outbox
  retry; import completion uses the existing backfill-complete refresh event.

- Preserve typed IMAP verification failures through the public boundary: rejected
  credentials use 422, DNS/TCP/TLS use 502, and a bounded timeout uses 504.
  Return only closed domain messages, never provider authentication replies.

IMAP discovery/connect request identities deserialize as EmailStr before domain
admission. Discovery forwards the validated ownership-checked address, while persisted
promotion identities are validated once when read. Parse failures map to closed
errors without logging the address.

First-visit inbox suggestions use the bounded catalog/MX-only adapter. Unknown
providers retain the generic chooser; full address-bearing discovery runs only
after the user explicitly opens IMAP setup.

IMAP worker composition gives live and historical-import providers separate
client classes. Background settings scans and link-maintenance jobs also use a
background client. Preserve the original interactive gateway for API settings,
user commands, draft materialization, attachments and sends; never classify all
`MailboxGateway` methods as background, because API and worker contexts share it.

The IMAP gateway preserves AccountBusy as a local rate-limit refusal with the
engine's five-second retry hint. MessageTooLarge is permanent. Neither changes
credential health or proves a send outcome; generic connectivity remains
uncertain. Recent inbox sources contain complete MIME only; the engine defers
individual busy or oversized items instead of returning partial bodies.

Map engine MessageTooLarge through ContentTooLarge to coded HTTP413
(message_too_large) on original-source and attachment downloads. Provider-backed
message/settings errors use the same content-limit response; keep sign-in and
mailbox health classifications separate.

The inbox catalog exposes mailbox_issue independently of needs_reauth. Oversized sync is visible as sync health; do not map it to a rejected password.

Successful verified IMAP reconnect clears the old projected mailbox issue and retry deadline while advancing the same link generations. Preserve CredentialsUnreadable as saved-credential unavailability, never AuthRequired or definite SendUnavailable.

`outbound/mailbox_provider_repair.rs` implements the email domain's automatic
legacy reconciliation repair. The pubsub composition gives it a separate
one-connection pool per replica until completion, with bounded keyset pages,
pacing and durable fenced progress. Validation runs only after scan completion,
off request paths; failures back off and alert without failing a deploy. No
operator step is required. See [the runbook](../../docs/runbooks/email-provider-repair.md).

IMAP category deletion lists Organization metadata (flags and keywords), never
full MIME bodies. An oversized message must not prevent removing its keyword.

Follow the [validation cap and recovery contract](../../docs/runbooks/email-provider-repair.md#validation-failures-and-the-constraint-cap).
