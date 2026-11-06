# email

## What it is

The core of the Email feature: threads/messages orchestration, scheduling
and reminders/followups, calendar-invitation extraction, and the AI email
tools — hexagonal, heavily feature-gated.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: the domain service and the
  traits its adapters implement.
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
- Not here: raw provider API calls → `email_api_client`; HTML
  parsing/sanitization → `email_utils`; SQLx queries over email tables →
  `email_db_client`.

## Boundaries

- Depends on: `entity_access`, `entity_access_management`, `email_utils`,
  `crm`, `frecency`, `item_filters`, `lexical_client`, `macro_event_broker`,
  `calendar_events` (optional, feature `calendar_invitations`), `sqs_client`
  (optional, feature `sqs`; it must not depend back on this crate).
- Used by: many crates and services, including `ai_tools`, `graphql_email`,
  `teams`, `databases_sql`, `attention_feed`, `calendar_service`, `email_service`,
  `email_scheduled_handler`, `search_processing_service`.

## Recipes

- Add a route: `src/inbound/axum.rs` → `src/domain/service.rs` →
  the relevant `src/outbound/*.rs` adapter.
- Add an AI tool: `src/inbound/toolset.rs` → `src/domain/service.rs`.
- Add a feature-gated adapter: add the optional dependency and a feature in
  `Cargo.toml` → `src/outbound/<name>.rs` → declare it in `src/outbound.rs`.

## Checks

- `cargo test -p email --all-features` (`SQLX_OFFLINE` unset; the `outbound`
  feature's tests need a local MacroDB — `just setup_macrodb`).

## Gotchas

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
- Restore Outlook junk drafts to Drafts without Inbox membership; continue rejecting
  attempts to mark clean drafts as junk.

- Reconcile deferred message deletion before claiming scheduled work; unresolved sends retain their message, attachments, and delivery job.
- Durable send admission supports Gmail and Outlook; Outlook delivery stays with its provider coordinator.
- Carry the captured `draft_generation` through every draft mutation; advance it on send acceptance/cancellation under the message lock and preserve attempt tombstones after message deletion.

- Gmail thread label writes stage each thread's DB change, then enqueue one
  provider write per inbox holding only the messages whose labels changed
  (`stage_thread_labels` / `commit_thread_label_write` in
  `domain/service/thread_labels.rs`); route new label actions through them.
- Recompute thread metadata inside staged Gmail SPAM/TRASH writes so restored All Mail previews, ordering, and signal state do not wait for the provider worker.
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
- Sender domain counts (`domain/sender_domain_counts.rs`, behind email-service's
  `POST /email/senders/domain-counts`) ask Gmail and Graph live, because they
  serve onboarding before any mail has synced. Only the caller's own active
  inboxes count; delegated inboxes are left out. Queries run in a spawned task
  and the request stops waiting after 5 s: never cancel one mid-flight, since a
  cancelled Graph request keeps its mailbox gate slot until the 90 s lease ends.
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
  through `record_done`/`record_deferred`/`record_failed`. The mailbox loops
  log their own deferrals with `link_id` (gate refusals at DEBUG), so the
  worker must not log them again. Add a new defer reason in `defer_reason`.
- Map database errors in `mailbox_pg` with `db_error` (or `wrapped_db_error`
  for `email_db_client` calls) so the SQLSTATE reaches the log; keep
  `MailboxError::Persistence` for stored data that cannot be decoded.
  `MailboxError::Effect` (`defer_reason=effect`) is for a projection effect
  that fails outside the database; email-service's `MailboxEffects` maps its
  database steps with `database_failed` and everything else with `failed`.
- "outlook import completed" fires from `settle_import` (`mailbox_pg.rs`)
  under the link lock, once per import run: the folder-catalog stream's
  `import_completed_at` is stamped when every folder is enumerated and no
  import row is left. A resync must reset `import_started_at` and
  `import_completed_at` and log "outlook import started", as
  `outbound/mailbox_pg/lifecycle.rs` does.
- Import counts for the health snapshot stay in memory (`ImportTally`) and are
  flushed once a minute to `email_mailbox_import_minutes`; never write per
  imported message for telemetry.
- Outlook organization commands only run in their link's current
  `sync_generation`. Anything that bumps it must rebind unfinished commands as
  `pending`, since claims skip `confirming` ones while those still block later
  commands, as reconnect (`email_service` `mailbox_init.rs`) and `rebind_work` in
  `outbound/mailbox_pg/lifecycle.rs` do; thread operations omit older generations.

## Related

- Rules: `.agents/rules/rust/architecture.md`

- Persist agent correlation with scheduled delivery and organization projection payloads, then restore it when publishing delayed activity.
