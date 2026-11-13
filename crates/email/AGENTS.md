# email

## What it is

The core of the Email feature: threads/messages orchestration, scheduling
and reminders/followups, calendar-invitation extraction, and the AI email
tools — hexagonal, heavily feature-gated.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the domain service and the
  traits its adapters implement.
- `src/domain/message_reads.rs` (feature `mailbox`): synced message/thread
  reads, access filtering, pagination, and summary-inbox selection.
- `src/domain/message_labels/state.rs` (feature `ports`): pending-write folding,
  restoration and batch validation; catalog operations also require `mailbox`.
  Its PostgreSQL adapters borrow the caller's transaction or pool.
- `src/domain/scheduled_delivery.rs` (feature `ports`): the composed
  `ScheduledDeliveryService` delegates each delivery to the fenced workflow.
  Its `state`, `identity` and `deletion` modules (feature `mailbox`) own claim,
  reconciliation and retained-deletion decisions; `outbound/scheduled_delivery_pg.rs`
  implements the transaction capabilities.
- `src/domain/mailbox/calendar_disconnect.rs`, `mailbox/contacts/list.rs`, and
  `scheduled/drafts.rs` (feature `mailbox`): separate use cases for calendar
  removal, contact listing, and scheduled-draft pages; ownership/delegation
  checks are shared through `mailbox/catalog.rs`.
- `src/domain/signature_settings.rs` (feature `mailbox`): signature preparation
  and settings patches. `signature_settings/gmail_images.rs` selects public or
  mailbox image reads, caches message parts for one import, and preserves retryable
  image failures behind an image-reader port.
- `src/domain/invitations.rs` (feature `calendar_invitations`): composes saved
  invitation resolution and import with their snapshot and calendar ports;
  HTTP handlers pass only the authorized thread receipt and request values.
- `src/domain/attachment_cleanup/sfs_deletion.rs` (feature `ports`): stored-file
  deletion order, the already-missing-file rule, and delivery disposition.
- `src/domain/mailbox/contacts/sfs_upload.rs` (feature `mailbox`): URL-backed
  contact-photo uploads, best-effort persistence, self-contact refresh, and
  delivery disposition.
- `src/domain/crm_cleanup.rs` (feature `mailbox`): nightly cleanup job lifecycle,
  candidate pruning and dispatch, teardown guards, and delivery disposition.
- `src/domain/mailbox/gmail_push.rs` (feature `mailbox`): key-cache fallback,
  push-token rotation retry and notification intake; lifecycle also owns ordered
  deletion requests for a deleted user's inboxes.
- `src/domain/mailbox/connection.rs` (feature `mailbox`): inbox connection,
  completed/discovered Google grants, shared promotion, and failed-attempt cleanup.
  Reuses mailbox initialization and backfill-job services.
- `src/domain/backfill_jobs.rs` (feature `mailbox`): backfill-job access,
  cancellation, active-job reuse, and initialization publication. Its `worker`
  module owns queue admission, retry/deferral policy, listing, thread/message
  import, initialization, completion accounting and leases, metadata, attachments,
  sent contact seeding and CRM operations. Its `outbox` module owns durable
  initialization, completion and consent publication through transaction ports.
  Backfill and inbox sync share catalog reconciliation, contact parsing,
  CRM normalization and pending-label snapshot rules. Inbox sync and link manager
  share notification-recipient selection.
- `src/domain/mailbox/link_manager.rs` (feature `mailbox`): link-maintenance
  delivery disposition, probe timeout, and reconnect notification recipients. It
  reuses the mailbox health and lifecycle services. Its `deletion` service owns
  provider teardown and retries, CRM cleanup, physical deletion, completion
  events and promoted-mailbox cleanup through capability ports. Its `purge`
  service owns incremental deletion order, cursors, batching, pacing and counters;
  `outbound/mailbox_pg/purge.rs` holds its transaction adapter.
- `src/domain/mailbox/inbox_sync.rs` (feature `mailbox`): Gmail delivery admission,
  disposition, provider-error routing, message deletion, and label reconciliation.
  It also owns history/catalog reconciliation, recovery backfills, provider-message
  imports, attachment claim release, contact fan-out and notification selection.
  Reuse the existing Gmail history journal and backfill repository through its ports.
- `src/inbound/axum.rs`: HTTP routes (feature `axum`); `src/inbound/toolset.rs`:
  the AI email tools (feature `ai_tools`).
- `src/outbound/email_pg_repo.rs`, `src/outbound/invitation_pg.rs`: Postgres
  adapters (feature `outbound`); `src/outbound/email_service_http.rs`: calls
  into `email_service`; `src/outbound/s3_draft_attachment_storage.rs`: staged
  draft attachments (feature `s3`); `src/outbound/sqs_enqueuer.rs`: the
  `EmailMessageEnqueuer` adapter for `sqs_client::SQS` (feature `sqs`).

## Scope

- Owns: email/thread domain logic, scheduled delivery, reminders/followups,
  calendar invitation extraction and resolution, adding a forwarded
  event (`METHOD:PUBLISH`) to the viewer's calendar (`domain/invitation_import.rs`),
  and forwarding one of the viewer's events from the inbox holding their copy
  (`domain/event_forward.rs`): that same file, or, for an organizer outside
  Google, a real invitation (`METHOD:REQUEST`) sent as the message's calendar
  body to the recipients and the organizer, whichever the calendar decides.
- Provider protocol implementations live in `email_api_client`; HTTP/queue
  hosting lives in `services/email_service`; HTML parsing/sanitization lives in
  `email_utils`. PostgreSQL adapters in this crate and `email_db_client` perform
  database I/O; domain modules call their ports.

## Boundaries

- Depends on: `entity_access`, `entity_access_management`, `email_utils`,
  `crm`, `frecency`, `item_filters`, `lexical_client`, `macro_event_broker`,
  `entity_access_db_utils` (optional, feature `outbound`), `calendar_events`
  (optional, feature `calendar_invitations`), `sqs_client` (optional, feature
  `sqs`; it must not depend back on this crate).
- Used by: many crates and services, including `ai_tools`, `graphql_email`,
  `teams`, `databases_sql`, `attention_feed`, `calendar_service`, `email_service`,
  `email_scheduled_handler`, `search_processing_service`.

- Hosts construct concrete adapters and inject them into domain services.
  HTTP handlers and worker deliveries reuse those composed services; they do
  not reconstruct repositories for each call. See the
  [backend architecture](../../docs/architecture/email-backend.md)
  for the service map, guard exceptions and remaining legacy adapter policy.
- The domain/inbound guards reject direct infrastructure use, including provider
  repositories and environment reads. Existing storage composites in
  `email_db_client` and the remaining adapter decisions still need individual
  review; a clean guard scan does not certify those layers.

## Recipes

- Add a route: `src/inbound/axum.rs` → `src/domain/service.rs` →
  the relevant `src/outbound/*.rs` adapter.
- Add an AI tool: `src/inbound/toolset.rs` → `src/domain/service.rs`.
- Add a feature-gated adapter: add the optional dependency and a feature in
  `Cargo.toml` → `src/outbound/<name>.rs` → declare it in `src/outbound.rs`.

## Checks

- `cargo test -p email --all-features` (`SQLX_OFFLINE` unset; the `outbound`
  feature's tests need a local MacroDB — `just setup_macrodb`).
- Run root `just check`; boundary-rule changes also run the
  [native ast-grep tests](../../docs/development/style-guide.md#email-backend-boundary-checks).

## Gotchas

- Moving a thread into a folder (`update_thread_project`) calls
  `entity_access_db_utils::project_grants::refuse_filing_in` in the
  transaction that writes `project_id`, so a scoped agent session can't file
  it where the folder's grants would reach someone new.
- Keep the legacy read policies in `MessageReadService`: public reads union
  owned and delegated inboxes, internal summaries use only the newest owned
  inbox, and public/internal pagination have different invalid-bound behavior.

- `Subject` is a message-level filter literal. With a top-level subject term,
  each owned inbox gets a bound (not `unnest`) two-step subscan: threads in
  order with only the trigram-indexed subject match, then the full match
  (mailbox facts) per thread until LIMIT. Keep the `OFFSET 0` fences and the
  absence of an outer sort, or the planner joins every hit to its facts first;
  binding the inbox gives it that inbox's statistics instead of the average
  one. Spam and Trash skip the subscan (it can't read their folder date), and
  a subscan never picks its preview in the candidate stage
  (`uses_subject_subscans`). Subscan queries run with parallel workers off
  (`SET LOCAL max_parallel_workers_per_gather = 0`): workers ran far past the
  page LIMIT and read 15 times the buffers. Other subject trees keep the
  `has_thread_literals` mirror, so a page's LIMIT never counts threads the
  lateral drops. Match the bare `subject` column so the planner keeps its
  statistics. `Attachment(kind)` reads the denormalized thread flags
  `email_db_client` maintains.
- A requested sender may be a verified Gmail send-as alias, not just an inbox
  address: `resolve_sending_inbox` (AI tools) picks the inbox that owns it, and
  `resolve_sender` (drafts, REST `from`) checks it against the chosen inbox.
  Both read `EmailSenderProvider`, so a host that skips `with_sender_provider`
  refuses every alias. Outlook inboxes have no aliases here. The alias's
  display name is stored on the draft row (`from_name`), not only on the
  shared sender contact, which keeps an existing name and drops names for
  role addresses such as `support@`.
- The send route refuses an agent's program (`refuse_program_send`, 403), and
  the schedule route admits one only with a quoted `user_confirmation`: a
  program sends through a session review, the harness's confirmed send
  (`SendEmail`/`SendConfirmedEmail`), or a confirmed draft schedule. Keep any
  new route that sends or schedules mail behind the same check.

- Focus's `decide` and `signals` are versioned: bump `FOCUS_RULE_VERSION` in
  `domain/focus/rule.rs` when either changes, or stored rows keep the old verdict
  until new mail arrives. The worker's sweep re-decides older rows from their
  stored `scores`, without calling Jev. `rule/experiment.csv` holds the expected
  verdicts for 643 real threads; report how far a rule change moves them. A new
  question's answer is `#[serde(default)]`, so stored `scores` still decode, and
  needs no bump when it decides nothing at 0.
- Nothing reclassifies a Focus thread as it ages, so `focus_pg` applies the wait
  and the calendar hold when it reads: `awaiting_reply` and `calendar_hold_until`
  are stored, `FOLLOW_UP_AFTER_DAYS` and the time are passed in. `focus_thread_ids`
  and `focus_for_threads` restate the same tests; change both.
- `focus_for_threads` also moves importance when it reads, with
  `domain/focus/importance.rs`: `importance_rate` is stored and the clock starts at
  `classified_message_ts`. The stored `importance` is the base, and the floors in
  `domain/focus/rule.rs` only set that base. Importance never decides membership,
  so `focus_thread_ids` doesn't read it.
- In Focus, Calendar only means a change whose event isn't over: the read sets it
  from `calendar_hold_until`, and the stored `category` is what the thread reads as
  afterwards. A stored Calendar is a new invite or RSVP left out, and
  `NEW_INVITES_STAY_OUT` in `domain/focus/rule.rs` is the switch for new invites.
  `stale_threads` restates `domain/focus/calendar.rs`'s test for a change in SQL;
  change both.
- A Focus thread's `due_on` is read when new mail is classified, only for a thread
  with `is_focus` or `awaiting_reply`, and never on the re-decide path: that path
  keeps the stored date and calls no model, so `save` writes back what
  `StoredClassification` read. A failed or timed-out read stores no date and never
  fails the classification. `input.rs` gives the extractor each of the latest
  messages' own words, never quoted history, so a relative date counts from the
  message that wrote it. A message's day is its writer's: the owner's own mail in
  their calendar zone, anyone else's at its `Date` header's offset, each falling back
  on the other, then UTC. Store no mail text or extracted span.
- A thread holding only the owner's sent mail stays out of Focus on purpose:
  it has `inbox_visible` false, which the client reads as Done, Mark Done cannot
  change it, and there is no inbound mail for the rule to judge.
- Treat DATE property literals as non-matches; apply ordinary boolean negation and keep non-date email filtering unchanged.
- All Mail excludes present messages in spam/junk or trash before pagination;
  canonical cached previews and non-draft baselines use the same rule for Gmail
  labels and Outlook mailbox facts. Mixed threads show their latest eligible message.
  Synced Macro drafts in junk/trash must not advance All Mail timestamps.
  Filtered and unfiltered All Mail share the dynamic builder and its per-inbox
  ordered, limited scans; do not add a separate whole-mailbox sort.
- Spam and Trash seed candidates from indexed provider labels/folder state plus pending positive moves, then recheck canonical mailbox facts before pagination. Order by the latest matching message date; metadata touches and unrelated replies must not move folder rows. Only Trash relaxes the default trash exclusion.
- A thread read by id (`emailThread`, `soupUpdates` hydration, mutation replies)
  renders as All Mail shows it, else as its Spam or Trash row
  (`thread_previews_by_id` in `domain/service/previews.rs`); All Mail alone
  misses every spam-only or trash-only thread. Read the folders one thread at a
  time, at most `MAX_FOLDER_LOOKUPS` per read: the folder scan reaches only that
  thread's messages through an equality on its id, and an `OR` of ids reads the
  inbox's whole folder.
- Restore Outlook junk drafts to Drafts without Inbox membership; continue rejecting
  attempts to mark clean drafts as junk.

- Reconcile deferred message deletion before claiming scheduled work; unresolved sends retain their message, attachments, and delivery job.
- `domain/scheduled_delivery/{state,identity,deletion}.rs` owns claim
  classification, sent-identity adoption and retained-deletion sequencing.
  `outbound/scheduled_delivery_pg.rs` supplies caller-owned and independent
  transaction capabilities using the statement-sized queries in `email_db_client`;
  keep relational guards in SQL. Compose `ScheduledDeliveryService` once while
  keeping claims and transactions per delivery. Scheduled page validation and
  expansion sequencing live in `domain/scheduled/drafts.rs`.
- Durable send admission supports Gmail and Outlook; Outlook delivery stays with its provider coordinator.
- Carry the captured `draft_generation` through every draft mutation; advance it on send acceptance/cancellation under the message lock and preserve attempt tombstones after message deletion.

- Gmail thread label writes stage each thread's DB change, then enqueue one
  provider write per inbox holding only the messages whose labels changed
  (`stage_thread_labels` / `commit_thread_label_write` in
  `domain/service/thread_labels.rs`); route new thread label actions through them.
  Message-label batches go through `domain/message_labels.rs`, with their atomic
  staging and unqueued-write undo behind `MessageLabelRepository`. The queued
  half lives in `domain/message_labels/gmail_ops.rs`: it owns turn ordering,
  partial acceptance/reversion, retry routing, and delivery dispositions through
  link, settlement, provider, and retry-queue ports. Provider admission remains
  inside the host's existing Gmail adapter.
- Recompute thread metadata inside staged Gmail SPAM/TRASH writes so restored All Mail previews, ordering, and signal state do not wait for the provider worker.
- `domain/recent_inbox.rs` merges a user's newest messages read live from
  each of their own inboxes (50 by default, at most 100); an inbox whose read
  fails is skipped. Subjects are cut to 200 characters and snippets to the
  caller's `snippet_chars` (the provider's 300 by default, at most 500, past
  the preview taken from the body) there, not in the adapters; each message
  carries its label names.
- `.eml` downloads go through `domain/message_source.rs`, which authorizes like
  attachment reads and fetches the provider's original RFC 822 bytes (Gmail
  `format=raw`, Graph `$value`); drafts and unsynced messages have no source.
- An attachment links to its document before the bytes reach storage, and a link
  stops sync from offering it again. `AttachmentReadService::document` stores the
  bytes again when a linked document is still awaiting its upload, and DSS signs a
  new upload for that reuse; DOCX is left out because it stays pending while it
  converts.
- Forwarded attachments register through `domain/draft_attachments.rs` and resolve
  bytes through `domain/attachment_access.rs`; scheduled delivery also rechecks
  source inbox access in `domain/forwarded_attachments.rs`, including legacy jobs.
- A send with files staged before delivery goes through
  `StagedAttachmentSender` (`domain/service/attachments.rs`): draft, staged
  attachment rows, then the send. `DraftAttachmentSender` adds Macro documents
  as the source of those files for `SendEmail`; a caller that already holds
  the bytes, such as an event forward's `.ics`, uses `send_with_files`. A
  `SourcedAttachment` with `is_inline` (no Content-ID) is staged inline and
  becomes the message's `text/calendar` body at delivery (see
  `email_api_client`'s `SendRequest::build_mime`); use it only for an
  invitation's calendar part.
- Saved invitation snapshots are JSONB and never re-extracted. `recurrence`
  is `None` on snapshots saved before it was recorded, where a series looks
  like a single event, so those cannot be added to a calendar.
- The feature matrix (`ports`/`inbound`/`outbound`/`http_client`/`s3`/
  `gmail_token`/`ai_tools`/`attachment`/`calendar_invitations`/`axum`) gates
  most modules; check `Cargo.toml`'s `[features]` block for which one a new
  dependency belongs under before wiring it in.
- `domain/ports.rs` defines the traits adapters implement — call through the
  domain service, never an outbound adapter directly from another crate.
- `domain/message_labels/state.rs` owns pending-write turn folding, restoration
  sequencing, batch validation/count interpretation, and catalog id/deletion
  policy; `outbound/label_state_pg.rs` borrows the caller's transaction or pool
  for the original statement-sized queries in `email_db_client`.
- `EmailRepo::stage_thread_label_change` reads which messages change, applies
  the change and marks the changed provider messages (exactly what
  `commit_thread_label_write` enqueues) in one transaction holding the thread's
  label-write lock. The enqueue carries the write's id; a group that can't be
  queued goes back through `EmailRepo::revert_staged_label_change`, which
  restores the state an older write still on its way left (or the original),
  never a newer write's change.
- A reply target outside the caller's inboxes is admitted only through
  `SharedThreadReplyAccess` (edit access to its thread; wired in
  `document_storage_service` with `with_shared_thread_replies`). The reply
  starts a thread in the caller's inbox; other hosts keep `NoSharedThreadReplies`.
- Sender discovery authorizes the inbox first. Gmail aliases use the sender
  provider; Outlook exposes its verified primary address without a Gmail lookup.
- Outlook links have no system label rows. Move a thread in or out of the inbox
  through `set_thread_inbox`, and read Outlook inbox, trash, and junk state from
  `email_message_mailbox_facts`, never from labels.
- Each `email_message_mailbox_facts` probe rebuilds a message's facts from its
  labels and pending state. In the dynamic preview query, give a view's facts
  condition to `view_mailbox_fact` so it shares the presence/trash probe in
  `build_preview_message_predicate` instead of adding a second one.
- Read receipts (`domain/read_receipts.rs`) own pixel policy for every send
  path: strip existing Macro pixels, track only HTML bodies, never block
  delivery on a tracking failure, and count opens only for sent messages.
  Tokens are stored per message, so a retried send or Outlook draft revision
  rebuilds the same URL; keep it that way or the draft fingerprints drift.
- Outlook sync telemetry (`domain/mailbox/telemetry.rs`, `progress.rs`) is a
  contract the Outlook sync monitors in `infra/stacks/monitoring` read: each
  claimed unit of `MailboxSyncService` and `MailboxProjectionService` opens
  one root `outlook.sync.*` span (idle polls open none) and records
  `outlook.outcome`, `outlook.defer_reason` and `outlook.defer_seconds`
  through `record_done`/`record_deferred`/`record_abandoned`/`record_failed`.
  The mailbox loops log their own deferrals with `link_id` (gate refusals at
  DEBUG), so the worker must not log them again. Add a new defer reason in `defer_reason`.
  Notification lag rides the same rows: a Graph change notification stamps
  the folder streams' `notified_at` and `notified_traceparent`. Every claim
  of the stream carries `notified_at` onto the reconciliation rows its pages
  queue (newest notification wins) until a checkpoint that started reading
  after the notification clears it; enumerate and reconcile spans record
  `outlook.notification_wait_ms` and `outlook.notification_lag_ms`. The first
  claim of a stream or row takes the traceparent (clearing it) and adopts the
  webhook's trace (`crate::trace_context`), so webhook to import is one
  trace, while retries get traces of their own and a long deferral can't grow
  it. Subscription upkeep and webhook deliveries open
  `outlook.subscription.maintain` and `outlook.subscription.notify`; each
  lifecycle event logs "outlook subscription lifecycle event".
- Map database errors in `mailbox_pg` with `db_error` (or `wrapped_db_error`
  for `email_db_client` calls) so the SQLSTATE reaches the log; keep
  `MailboxError::Persistence` for stored data that cannot be decoded.
  `MailboxError::Effect` (`defer_reason=effect`) is for a projection effect
  that fails outside the database; email-service's `MailboxEffects` maps its
  database steps with `database_failed` and everything else with `failed`.
  Its `EffectFailure` names the effect (`outlook.effect`) and, for attachment
  uploads, the attachment (`outlook.attachment_id`); never return one without
  a cause.
- "outlook import completed" fires from `settle_import` (`mailbox_pg.rs`)
  under the link lock, once per import run: the folder-catalog stream's
  `import_completed_at` is stamped when every folder is enumerated and no
  import row is left. A resync must reset `import_started_at` and
  `import_completed_at` and log "outlook import started", as
  `outbound/mailbox_pg/lifecycle.rs` does.
- A message reconciliation that keeps failing is abandoned
  (`message_retry` in `domain/mailbox.rs`): its row waits at
  `available_at = 'infinity'` with attempts reset, so claims stop at their
  index bound and every enqueue's `available_at = now()` revives it. Any query
  that reads queued or import-running state must leave those rows out, as
  `settle_import`, the health snapshot, the backfill status and resync do.
  Throttling and token refusals give their claim back to `attempts`, and so
  does a transient provider failure (Graph 5xx or 408, a request Graph never
  answered) once its backoff is at 30 minutes, so a provider outage never
  abandons a message.
- Outlook sync claims (catalog, folder streams, messages, contacts) skip a
  link with `needs_reauth`; clearing the flag resumes them.
- Process deleted-user bindings in the domain by link id, custodian before
  owner, then actor id, retaining one binding per link and actor; the repository
  returns each binding's kind so custody cleanup runs before an owner disconnect
  can suppress it without processing a self-custodian twice.
- `email_mailbox_folders.total_item_count` is Graph's `totalItemCount` from the
  latest catalog discovery (every 5 minutes, from the listing discovery already
  makes), and the discover span sums it as `outlook.provider_item_count`. It
  counts what the folder holds at the provider, imported or not, so an import
  is checked against it.
- `email_sync_streams.reader_revision` is the folder reader revision a mail
  folder stream's current delta round started at, written by `commit_page` on
  the round's first page and copied by `rebind_work`. `domain/mailbox/reimport.rs`
  restarts streams whose round started at an older revision (or none), Inbox
  and Sent first, through the Outlook resync's reset limited to those folders;
  a new query that copies or resets streams keeps the column consistent.
  `PgMailboxSync::with_imports_paused` makes `claim_message` take only live
  rows (`is_import IN (false,$2)` keeps both values named for the claim index).
- Import counts for the health snapshot stay in memory (`ImportTally`) and are
  flushed once a minute to `email_mailbox_import_minutes`; never write per
  imported message for telemetry.
- Outlook organization commands only run in their link's current
  `sync_generation`. Anything that bumps it must rebind unfinished commands as
  `pending`, since claims skip `confirming` ones while those still block later
  commands, as reconnect (`email_service` `mailbox_init.rs`) and `rebind_work` in
  `outbound/mailbox_pg/lifecycle.rs` do; thread operations omit older generations.
  The same bumps delete older generations' `email_sync_streams` and
  `email_message_reconciliation` rows: claims never take them, and left in place
  they stay due and every lease claim reads past them.

## Related

- Rules: `.agents/rules/rust/architecture.md`

- Persist agent correlation with scheduled delivery and organization projection payloads, then restore it when publishing delayed activity.
