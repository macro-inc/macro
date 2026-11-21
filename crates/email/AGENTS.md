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
  `worker/crm_policy.rs` retains the original consent incarnation/version and
  durable job ID through every page and effect. Legacy CRM history cannot adopt
  initialized consent. Mark new per-message hints `live_mail=true`; the legacy
  history fan-out explicitly uses false. Modern publication retains a recovery
  signal until exact-generation progress/completion; legacy publication deletes.
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
- `src/outbound/email_pg_repo/dynamic/filters/address_queries.rs`: shared
  address-index streams for owned and Team reads; Team selection queries live
  beside `dynamic/query/team_scope.rs`.
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

- Personal data stays off spans and logs (`.agents/rules/observability.md`);
  here that also means a `MacroUserIdStr` parse error, which quotes the
  address. `draft_save_and_delete_spans_record_no_personal_data` reads the
  draft spans back.
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
- An owned All Mail page filtered to one positive OR-tree of addresses (Sales
  Email and a CRM record's emails under Me, a sender or recipient search, Soup
  hydration by id with an address template) is read in page order by `OwnedRead`
  (`dynamic/query/owned_scope.rs`): a capped probe counts the address
  superset, then either the sorted superset or each inbox's newest threads
  stream into the preview pick until LIMIT. A page that the inbox stream's
  first window (10 threads per row, at most 1,000) leaves short goes on below
  the last walked thread in rounds: the next, four times larger window (at
  most 16,000) while the last window found rows fast enough to fill the page
  in it, else (and always after a window without rows) first a probe capped
  by the walk the page still needs at that rate (`round_cap`, at most
  800,000 rows) and the superset below once it fits. Judge by the last
  window, not the page: a page that found most of its rows early would walk
  on far below the last of them. Keep every statement
  capped: a walked thread the addresses miss costs a read of each of its
  messages, so a cold window of addresses gone quiet costs several times
  their superset.
  A filter with any other top-level message term (a subject, an address
  under `NOT`) goes to the general builder: the pick could drop most of the
  window and the read would end up slower. A domain or partial address lists
  a thread only through the queried inboxes' own contacts, as
  `matching_threads` requires, while the preview pick keeps its match on any
  contact (`ContactScope`). Keep the `OFFSET 0`
  fence and the stream's `ORDER BY`, or the planner joins the whole stream to
  its facts. The read runs in one repeatable-read, read-only transaction (a
  page's rounds see one snapshot, so their rows concatenate) and, like the
  general builder's owned requests, has no `statement_timeout`.
  `test/owned_address_read.rs` compares every tuning's pages with the general
  builder; extend it when the read covers a new filter. A repeated inbox id
  reads as one in every builder (`distinct_links`).
- Address supersets keep joined and indexed text branches. Use indexed sender
  lookups in the initial capped probe and the sparse page it selects, in both
  Team and Owned reads; the `OFFSET 0` keeps generic plans on
  `idx_email_messages_from_contact_id` instead of scanning every message. Each
  sender lookup stops one past the initial superset cap, so generic plans can
  stop on that index instead of building a bitmap of all its messages; the
  cap cannot truncate a page the probe proved sparse.
  Indexed text-recipient lookups apply only to all-recipient-role groups. A rare
  requested role can scan a dense domain before the cap finds a match, so
  role-restricted text-recipient groups keep joined SQL. Complete-address
  all-role recipient branches drive their capped probe and sparse page from
  the deduplicated contact IDs, with an `OFFSET 0` fence around each recipient
  lookup and message primary-key fetch. Restricted roles keep joined SQL so
  dense contacts can use role-first or parallel plans. Dense underfill
  fallbacks and larger Owned round probes also keep joined SQL; per-message
  probes can make those large sets slower. Checked General branches keep their
  original joins so mailbox-fact checks are planned with the messages. The
  initial Owned sparse page, like Team's superset, fetches distinct matched
  thread IDs through a primary-key fence before mailbox and cursor filters;
  its CTE estimate must not turn those IDs into a whole-mailbox filter.
  Optimized Team probes and pages share a read-only repeatable-read snapshot,
  as Owned reads do, so imports cannot outgrow the probe's cap between statements;
  privacy changes
  committed mid-request apply to the next request. Resolve contribution modes
  in that snapshot too. If none of the requested contributors uses selected
  mode, keep the all-mail probe/page SQL without selected-rule work. General
  Team fallbacks keep that same snapshot through discovery and their page too;
  reopening a transaction can read a policy that discovery never checked.
- Selected Team reads require an injected `EmailRuleDiscoveryService` on
  `EmailPgRepo`. Discover once in the read snapshot and reuse complete contacts
  in probe/page; all-mail reads call no discovery and keep their SQL unchanged.
  Preserve typed resource-limit failures through `EmailErr` and Soup: return
  HTTP 503 with the limit, never an empty or truncated page. The CRM core also
  admits policy writes; do not implement separate limits in the email adapter.
  A bare repository fails closed for selected reads if composition omitted
  discovery. Keep General's scalar eligibility read in the discovery snapshot.
  In optimized selected pages, share the complete non-draft participant set
  between inclusion and domain vetoes; an early positive match must not hide
  a later private participant. Keep all-mail-only eligibility SQL unchanged.
- A requested sender may be a verified Gmail send-as alias, not just an inbox
  address: `resolve_sending_inbox` (AI tools) picks the inbox that owns it, and
  `resolve_sender` (drafts, REST `from`) checks it against the chosen inbox.
  Both read `EmailSenderProvider`, so a host that skips `with_sender_provider`
  refuses every alias. Outlook inboxes have no aliases here. The alias's
  display name is stored on the draft row (`from_name`), not only on the
  shared sender contact, which keeps an existing name and drops names for
  role addresses such as `support@`.
- The send route and `email_service`'s calendar invite forward refuse an
  agent's program (`refuse_program_send`, 403), and
  the schedule route admits one only with a quoted `user_confirmation`: a
  program sends through a session review, the harness's confirmed send
  (`SendEmail`/`SendConfirmedEmail`), or a confirmed draft schedule. Keep any
  new route that sends or schedules mail behind the same check. A program
  answering a channel mention (`is_channel_mention_run`, its token's signed
  `channel_mention_id`) is refused even with a quote, here, at the
  harness's confirmed send, and at `email_service`'s calendar-event forward.

- Focus's `decide` and `signals` are versioned: bump `FOCUS_RULE_VERSION` in
  `domain/focus/rule.rs` when either changes, or stored rows keep the old verdict
  until new mail arrives. The worker's sweep re-decides older rows from their
  stored `scores`, without calling Jev. `rule/experiment.csv` holds the expected
  verdicts for 643 real threads; report how far a rule change moves them. A new
  question's answer is `#[serde(default)]`, so stored `scores` still decode, and
  needs no bump when it decides nothing at 0.
- Nothing reclassifies a Focus thread as it ages, so `focus_pg` applies who wrote
  last, the wait, the due day, the calendar hold and the meeting being over when it
  reads: the owner's latest message takes a thread out, and only `awaiting_reply`
  brings it back, after `FOLLOW_UP_AFTER_DAYS` or at `due_at`; once
  `calendar_hold_until` or `event_over_at` passes, the thread is out whatever else
  it reads as, until newer mail. The verdict, `due_at` and `event_over_at` are
  stored; `FOLLOW_UP_AFTER_DAYS` and the time are passed in. `focus_thread_ids` and
  `focus_for_threads` restate the same tests; change both. "No mail since the
  classified message" compares `(at, id)` in the order the worker picks its latest
  message, so another message at the same instant can count as newer; `save`
  keeps the newer verdict by the same pair, or a late verdict on the message
  that sorts first would read as mail since it. The dates
  count only while `dates_classified_at` equals `classified_at`: a writer from
  before them (a rolling deploy's old worker, a rollback) sets `classified_at`,
  even for the same message, and leaves them, and `thread_inbox` reads them the
  same way, so the sweep never carries them onto a later verdict. A new date
  column joins that test.
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
- Focus classifies an inbox only while someone whose Focus tab shows it is in the
  rollout (`FocusEnrollment`, the worker's locally evaluated `enable-email-focus`
  flag): its owner, or a user it is linked to (`macro_user_links.primary_macro_id`,
  read as `delegates` by `thread_inbox`, `inboxes_with_focus` and
  `syncing_inboxes`), so a linked inbox follows its primary user's flag. The
  worker counts someone in only while `activity`'s `UserActivity` finds them
  active in the last 7 days (`ActiveEnrollment` over the flag), so an inbox
  nobody reading it has used Macro for is not classified, backfilled or swept,
  and is backfilled again when they return. Check it
  after `thread_inbox` and before any mail is read. `enrolled_inboxes` checks every
  `syncing_inboxes` inbox, so a person who joins is found without mail, and
  `backfill` fills one inbox several threads at a time. The sweep goes inbox by
  inbox (`inboxes_with_focus` plus those seen enrolled) and leaves an inbox being
  backfilled to the backfill, so no thread is classified twice at once; `stale_threads` reads one
  inbox through its latest-inbound and latest-outbound indexes; keep its
  `OFFSET 0` fence, or the per-thread calendar and contact checks run on every
  thread in the window.
- A Focus thread's days (`due_on` and the day of the meeting it is about) are read
  in one call when new mail is classified, only for a thread
  with `is_focus` or `awaiting_reply`, never for a thread the backfill's second pass
  finds last active before its last 3 days (`DueDates::ReadSince`, which bounds a
  rollout step's extractor cost),
  and never on the re-decide path: that path
  keeps the stored dates and calls no model, so `save` writes back what
  `StoredClassification` read. `domain/focus/dates.rs` turns them into instants in
  the owner's calendar zone (`due_at`, and `event_over_at` at the start of the day
  after the meeting; with no zone, once a day has begun everywhere), leaving the
  meeting to a calendar change's own hold and to a deadline after its day. Mail
  written once the meeting's day is over (its notes or thanks) keeps that day,
  unless it leaves the owner something to do (`owner_has_something_to_do` in
  `domain/focus/rule.rs`: `needs_reply`, `needs_follow_up`, `awaiting_reply`, or a
  decision only they can make): then the thread is judged on its own. A meeting
  more than two weeks before the latest day any of the thread's messages was
  written on is dropped, by the read and again by `focus_dates`, which also
  counts the messages the read leaves out for having no text. Both take each
  message's day by its writer's calendar (`input.rs` `written_on`, so
  `last_written_on`), so with mixed offsets an earlier message can set that day.
  A failed or timed-out read stores no dates and never fails the classification.
  `input.rs` gives the extractor each of the latest messages' own words, never
  quoted history, so a relative date counts from the message that wrote it. A message's day is its writer's: the owner's own mail in
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
- A CRM record's Team view (team-scoped All Mail with one OR-tree of addresses)
  reads through `TeamRead` (`dynamic/query/team_scope.rs`): threads stream in
  page order from the record's address superset or from each contributing
  inbox's newest threads, and each gets the message match and the privacy rule
  until the page fills. Keep its `OFFSET 0` fences, or the planner checks the
  whole stream before the LIMIT. Fetch each distinct superset or selection
  match through the fenced lateral primary-key lookup: even `id = ANY(…)`
  can become a mailbox-wide index filter under stale statistics. `team_blocked` relies on `crm_companies_email_sync_off_idx`, or it
  scans every company. `push_allowed` restates `crm_email_thread_allowed`
  set-based, and the contributing inboxes in `dynamic/resolve.rs` restate its
  mailbox conditions (`allowed_restates_the_privacy_function` and
  `contributing_inboxes_restate_the_privacy_function` compare them); change
  them together. Selected mode also resolves the active policy's live targets
  once per page, retaining bounded IDs for per-thread indexed probes. Its
  positive-target probe runs before the record probe and
  resolves live company domains once against each selected mailbox's
  contacts. All-mail-only reads skip selected-rule discovery.
  Keep selected-policy contact resolution within the requested mailboxes;
  record probes and sparse pages reuse the shared indexed sender/recipient
  branches. Positive-target discovery probes participants by their IDs. Do not
  add a redundant mailbox condition inside a sender lookup; contacts already
  scope it, and the competing index can scan the entire mailbox. All statements share
  the ten-second deadline. The three-way selected parity suite compares the
  real scalar, ingestion SQL and inline rule, including whole-thread matches
  and hidden/deleted live targets. Apply `crm_email_thread_excluded` to both the
  candidate and competing copies; a copy stays only when no better copy passes
  the same checks,
  so the representative never depends on the cursor; `test/crm_team_read.rs`
  compares every stream with the general builder page by page. The superset
  keeps only the read inboxes' own contacts, because a message lists only its
  own inbox's contacts (`parse_and_upsert_message_contacts`); a writer that
  broke that would drop threads from the Team view, and their conversations'
  other copies with them (`docs/CRM_EMAIL_PRIVACY.md`).
- `TeamRead` also covers `ViewedUpdated` when the filter itself does not use
  view history. A saved view overrides message recency, even if the view is
  older; keep `COALESCE`, not `GREATEST`. Sparse matches use the history primary
  key. Dense pages merge viewed and never-viewed sources, complete timestamp
  ties before the ID tiebreaker, and refill below the last raw window in the
  same snapshot. Apply source filters before each cap so a short source proves
  exhaustion. Competing copies use their own view time and never the page or
  refill cursor. Discard accumulated rows on any later error. Emitted windows
  do not bound rejected rows or history ties; retain the request deadline.
  `crm.team_email_read` records the sort and `general`/`optimized` path across
  both branches, including errors; its optimized child records refill rounds.
  ViewedAt filters and sorts still use General.
- The unfiltered inbox's viewed sorts (`preview_views/new_inbox.sql`) never sort
  the inbox: each inbox takes a page of opened threads and a page of
  never-opened threads (`idx_email_threads_inbox_reminder_sort` for
  `viewed_updated`, `idx_email_threads_inbox_id` for `viewed_at`), and the
  pages are sorted together. Never-opened threads are read only down to the
  page's last opened thread. Opened threads come from the inbox's newest views
  (`idx_email_user_history_link_viewed`), capped at four pages' worth; an
  inbox that archives what it reads would otherwise walk its whole history, so
  when the cap neither fills the page nor ends the history its inbox threads
  are read instead. That index must not gain `thread_id`: the planner would
  then scan an inbox's history for every per-thread history lookup. Keep the
  `OFFSET 0` fences: without them the planner joins and sorts the whole inbox
  or walks the whole history.
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
- Include a reader’s cross-inbox reply draft on a shared thread at Edit only
  when it belongs to an inbox in the reader’s Drafts scope. Apply the same
  rule to full and parsed thread reads.

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
  staging and unqueued-write undo behind `MessageLabelRepository`. A thread on
  an Outlook inbox, or a message batch whose first message resolves to one,
  takes its label as one category mailbox command (`enqueue_mailbox_action`)
  instead of a Gmail label write. The queued
  half lives in `domain/message_labels/gmail_ops.rs`: it owns turn ordering,
  partial acceptance/reversion, retry routing, and delivery dispositions through
  link, settlement, provider, and retry-queue ports. Provider admission remains
  inside the host's existing Gmail adapter.
- Recompute thread metadata inside staged Gmail SPAM/TRASH writes so restored All Mail previews, ordering, and signal state do not wait for the provider worker.
- Gmail Report spam and Not spam move the thread between the inbox and Spam
  (`set_gmail_thread_junk`): a SPAM write and an INBOX write, each its own
  thread label write, and the agent tool `UpdateThreadLabels` routes `SPAM`
  there too. Never send the SPAM label alone for them; only the REST and
  GraphQL label routes (`update_thread_labels_for_user`) write exactly the
  label they are given.
- `domain/recent_inbox.rs` merges a user's newest messages read live from
  each of their own inboxes (50 by default, at most 100); an inbox whose read
  fails is skipped. Subjects are cut to 200 characters and snippets to the
  caller's `snippet_chars` (the provider's 300 by default, at most 500, past
  the preview taken from the body) there, not in the adapters; each message
  carries its label names.
- `.eml` downloads go through `domain/message_source.rs`, which authorizes like
  attachment reads and fetches the provider's original RFC 822 bytes (Gmail
  `format=raw`, Graph `$value`); drafts and unsynced messages have no source.
- Deleting mail sends the Drive documents imported from it to the Trash: when
  a statement removes a live document's `document_email` rows (a message,
  thread or inbox delete, a purge batch, a replaced attachment, all through
  cascades), the `document_email_release` trigger queues it in
  `released_email_attachment_documents` (migration `20261116200143`), and
  document storage trashes it if no link is left and its owner did not adopt
  it. Moving a link (sent-identity adoption) inserts the new row before
  deleting the old one, so the document is never without a link; keep that
  order in any new path.
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
- Let first saves adopt unbound reply drafts by reply target. Keep separately
  bound working copies distinct when Undo restores a draft for that target.
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
  the folder streams' `notified_at` and `notified_traceparent` and makes them
  due without moving one already due (`LEAST(next_run_at, now())`): stream
  claims take the longest-due first across mailboxes, so a reset to now put a
  due stream behind every stream that came due since, and a mailbox notified
  more often than that line moved was never read. Every claim
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
- A change notification names its message (`resourceData.id`, an immutable
  id: every Graph request asks for them). With `NotifiedMessageReads` on (the
  email-service API sets it from `enable-outlook-notified-message-reads`),
  `accept_notification` also queues that message as live work in the same
  transaction (`queue_notified_message`, `from_notification = true`), so the
  next message turn reads it instead of waiting for its folder's claim. A row
  already queued for the message takes the newer revision: one row per
  message. Nothing is queued while a folder of the mailbox is in its import
  round (its pages queue import work, and a live read of an unstored old
  message would notify as new mail), or while the mailbox has
  `NOTIFIED_READS_AHEAD` live rows due. The checks read
  `email_sync_streams_link_import_rounds` and
  `email_message_reconciliation_live_queued`; keep their predicates and the
  query's identical. Message claims take live rows first in arrival order,
  so that is how far one mailbox's notifications can put others' new mail
  and every import behind its own. A notified read of a message in a folder
  the catalog does not list (hidden, or made since the last discovery) that
  is not stored settles as `unsynced` without storing it, since no folder
  page would list it; a stored one is read as its folder's page would, and a
  folder page that lists the message clears `from_notification`. The
  reconcile span records `outlook.from_notification`, and with
  `outlook.notification_lag_ms` it times notification to stored; the notify
  span counts `outlook.messages_queued`. Off, a notification only wakes the
  folders.
- Subscription upkeep (`domain/mailbox/watches.rs`) counts failed runs in a
  row in `email_mailbox_watch_work.failures` and backs off by it
  (`upkeep_retry`): a refusal up to the 12 h renewal cadence, a transient
  failure up to 30 minutes, throttling and token failures uncounted. Every
  write that bumps the row's `revision` (reconnect, rebind, lifecycle events)
  also resets `failures`; keep both in a new bump. Each
  `outlook.subscription.maintain` span records the count it leaves
  (`outlook.upkeep_failures`), and the health snapshot reports it as
  `watch_failures`.
- An Outlook message deleted at the provider keeps its row, marked
  `provider_missing` by `MailboxIngest::absent`, where Gmail's
  `delete_message` deletes it. `absent` leaves CRM cleanup candidates for its
  correspondents in the same transaction, only when it first marks the row
  (`crm_cleanup::candidate_emails` picks them for both), and readers that ask
  whether a mailbox still has mail with an address leave such rows out
  (`email_db_client`'s `link_has_any_message_with`, and CRM's
  `other_address_mail.sql` and `interactions.sql`).
- Open every `mailbox_pg` transaction with `PgMailboxSync::begin`, which sets a
  5 s `lock_timeout`, so a write queued behind a long lock holder (a CRM
  population share-locks its link) fails instead of holding a pooled
  connection; a locking read runs in one too. Pre-checks that a write repeats
  under the lock (settings access) and credential health that has not changed
  read without the lock, so reads and Graph calls never wait on it. The
  timeout is SQLSTATE 55P03
  (`MailboxError::is_lock_timeout`, `InboxLifecycleError::Contended`) and every
  caller retries it: lease release or expiry, message backoff, redelivery, a
  409 for user requests. A write that records a provider call's result (the
  draft checkpoint, a command's draft write version) retries it in-process
  through `record_after_provider`, and a delivery the queue would dead-letter
  (link deletion) retries in the same delivery, each a bounded number of times
  inside its lease or visibility timeout. The purge's batches run in
  `email_db_client` without the timeout.
- The user writes in `email_pg_repo` that lock an inbox's link row (draft
  save and send admission, attachments, discard, resolution, transfer,
  scheduling, Undo send, mailbox actions, sender policy) open with
  `email_pg_repo::begin`, the same 5 s `lock_timeout`
  (`email-link-lock-transactions-time-out`). Most take `FOR SHARE` on the
  link: it fences the mailbox workers and a disconnect, which lock it
  exclusively, while a CRM population, which share-locks it, runs alongside;
  user writes on one draft serialize on its message row and advisory locks,
  as Gmail's, which take no link lock, always have. Mailbox actions keep
  `FOR UPDATE`, because a command's `accepted_order` is allocated under it,
  and so does sender policy, like the settings worker. A timeout is
  `EmailErr::Contended` (`AttachmentError::Contended`): 409 on REST, 503 with
  `Retry-After` on attachment routes (whose 409 means the draft changed),
  and GraphQL `INBOX_BUSY` with `retryable`.
- Map database errors in `mailbox_pg` with `db_error` (or `wrapped_db_error`
  for `email_db_client` calls) so the SQLSTATE reaches the log; keep
  `MailboxError::Persistence` for stored data that cannot be decoded. Both,
  and email-service's `database_failed`, build a database failure with
  `MailboxError::database`, which reports a value the database will never
  accept (`is_unstorable_sqlstate`) as `Unstorable` (`defer_reason=unstorable`)
  rather than `Database` (`persistence`).
  `MailboxError::Effect` (`defer_reason=effect`) is for a projection effect
  that fails outside the database; email-service's `MailboxEffects` maps its
  database steps with `database_failed` and everything else with `failed`.
  Its `EffectFailure` names the effect (`outlook.effect`) and, for attachment
  uploads, the attachment (`outlook.attachment_id`); never return one without
  a cause. A failed attachment download or database step is not an effect, so
  email-service's attachment step records `outlook.attachment_id` for it
  before returning; the span carries the field once either way.
- `MailboxSyncService` reads through two gateways: `import_provider` for a
  folder page claimed before the folder's first round completes and for
  import reconciliation rows, `provider` for everything else, live passes
  included. email-service
  gives them the Microsoft gate's `Import` and `Live` budgets, so an import
  cannot take the slot live mail and calendar need.
- An import round's folder stream reads its next page only while its mailbox
  has fewer than 200 import rows due (`IMPORT_QUEUED_AHEAD`, checked by
  `pace_import` with a count capped there); otherwise it is put back for 10 s
  unread and its enumerate span reads `outlook.outcome=paced`. Rows backed off
  after their own failures don't count, so they never hold the walk. The count
  reads the partial index `email_message_reconciliation_import_queued`; keep
  its predicate and the query's identical, or a mailbox with fewer due rows
  than the cap reads the whole table. Message claims are first in, first out
  across mailboxes, so a walk that ran ahead would put every other mailbox's
  import, and any message that waited for room, behind its whole backlog.
  Gmail's backfill lists its next page behind the threads it queued for the
  same reason. Live folder streams are never paced.
  A mail folder claim takes an import round ahead of finished folders that
  came due less than five minutes before it (`IMPORT_ROUND_HEAD_START_SECONDS`
  in `claim_stream`, which picks the earlier of two one-row candidates). The
  import round comes off the partial index
  `email_sync_streams_import_round_claim`; keep its predicate and the query's
  identical, or each claim reads every due finished folder. Polls of every
  finished folder share the sync loops and run minutes late, and a round that
  waited behind them read a page only every few minutes while its import sat
  empty. A round waiting for room reads nothing: paced, or its page refused
  by the request gate while its mailbox's message reads hold the import
  slots, which waits the 10 s pace too. `enumerate_once` then goes on to the
  next due stream (up to `PACED_CLAIMS_PER_TURN`); otherwise a large import's
  waiting rounds, due again within seconds, would take the polls' turns.
  A message released after a failed read is due at once when a newer
  revision arrived during the lease.
- A folder's import round is a delta snapshot, so mail that arrives during it
  would wait for the whole round. While `LiveImportPass`
  (`domain/mailbox/live_pass.rs`, set by the host from PostHog) is on, an
  import round's first request reads newest first, and its first page that
  is not the round's last opens a `mail_folder_live` stream for the folder
  (`open_live_pass`, under the link lock): `initial_complete = true`, so its
  rows queue live and notify, it reads through `provider` and is never paced;
  its first request lists only mail received since five minutes before
  `import_started_at`, the round's `round_started_at` (the claim of its
  first page; a round recorded before that column falls back on the claim of
  the page that opened the pass), as Graph dates mail by Exchange's clock and
  mail can land after its date. `enumerate_once` claims a due live
  pass before any folder (`claim_stream` takes the kind). The round's
  checkpoint and `reset_stream` delete the pass in their transaction; resync,
  re-import and a removed folder delete it too, and a webhook wakes it. An
  expired live pass cursor starts over from now (`restart_live_pass`) and
  never requeues the folder. Off, live passes are not claimed and rounds read
  as before. Health, progress, import completion and the folder counts read
  `kind = 'mail_folder'` only: keep live passes out of them.
- "outlook import completed" fires from `settle_import` (`mailbox_pg.rs`)
  under the link lock, once per import run: the folder-catalog stream's
  `import_completed_at` is stamped when every folder is enumerated and no
  import row is left. A resync must reset `import_started_at` and
  `import_completed_at` and log "outlook import started", as
  `outbound/mailbox_pg/lifecycle.rs` does.
- A message reconciliation that keeps failing is abandoned
  (`message_retry` in `domain/mailbox.rs`), one the database refuses
  (`Unstorable`) after 3 tries, 10 minutes apart, as a Graph permanent
  refusal: its row waits at
  `available_at = 'infinity'` with attempts reset, so claims stop at their
  index bound and every enqueue's `available_at = now()` revives it. Any query
  that reads queued or import-running state must leave those rows out, as
  `settle_import`, the health snapshot, the backfill status and resync do.
  A recurring enqueue would revive them on every run, so queue a recheck
  once per change: the folder catalog rechecks a folder's stored mail only
  in the discovery that sees the folder leave, or move in or out of Deleted
  Items.
  A message whose claims keep ending with no outcome (its worker stopped
  holding the lease) is abandoned unread on the claim after five
  (`UNFINISHED_CLAIM_LIMIT`, `defer_reason=unfinished`): `claim_message`
  counts `unfinished_claims` from a lease still set when it claims, since
  every recorded outcome deletes the row or clears the lease. The first claim
  after a recorded release, or of a revision newer than the last claim read
  (`claimed_revision`), starts the count over, so a change that arrives
  during an unfinished claim is read.
  Throttling and token refusals give their claim back to `attempts`, and so
  does a transient provider failure (Graph 5xx or 408, a request Graph never
  answered) or a lock timeout once its backoff is at 30 minutes, so a provider
  outage or a busy mailbox never abandons a message.
- A projection event that keeps failing is given up as a message read is:
  `MailboxProjectionService::project_leased` decides with `message_retry`
  (backoff included), and `finish_projection` gives an uncounted claim back to
  `attempts`. One whose claims keep ending without an outcome is given up
  unprojected after `UNFINISHED_CLAIM_LIMIT`: `claim_projection` counts
  `email_projection_outbox.unfinished_claims` from a lease still set when it
  claims, since every recorded outcome deletes the entry or clears its lease.
  A given-up entry is deleted, not parked: an event is projected once, a later
  event for the link carries newer state, and a parked entry's `dedupe_key`
  would swallow a re-enqueue of the same message version. It logs one
  `mailbox projection abandoned` WARN holding only ids and kinds.
- A projection's attachment download or upload that keeps failing is counted
  on the attachment (`email_attachments.upload_failures`), not the event, and
  abandoned at the limit `attachment_failure_limit` in
  `domain/mailbox/projection.rs` gives: 3 refusals or 50 other failures. A
  transient download failure counts there, unlike a message read's, because
  Graph can cut the same attachment's download every time. The abandoned
  attachment keeps its upload claim and gets `upload_abandoned_at`, so no claim
  takes it and the projection stops waiting on it; nothing revives it, and
  opening it still downloads it on demand. email-service writes a failure only
  while the claim is still the one its claiming statement returned, so a pass
  that outlived the three-minute claim cannot undo the next pass's outcome.
- A message read Graph answers 404 settles as `absent` (`reconcile` in
  `domain/mailbox.rs`). Live work reads it twice more, 30 and 60 s apart
  (`location_unsettled`), because it follows a change Graph's read can
  briefly miss. Import work settles at once: it lists what a folder held or
  rechecks mail Macro stored, ids are immutable so a moved message still
  reads, and Deleted Items can list entries Graph never serves as messages,
  which held each import's end for about 90 s. So every live enqueue clears
  `is_import` on a row it merges into (`ON CONFLICT ... is_import = false`, or
  `AND EXCLUDED.is_import` for folder pages); keep that in a new one.
- Outlook sync claims (catalog, folder streams, messages, contacts) skip a
  link with `needs_reauth`; clearing the flag resumes them.
- A folder discovery that Graph answers 404 at the Inbox
  (`MailFolderCatalog::NoMailbox`: the account has no mailbox Graph serves)
  marks the link `mailbox_unavailable_at` (`defer_reason=no_mailbox`, the
  span's `graph.error_code`), fenced to its catalog lease like the commit,
  so a discovery that lost its lease can't mark a link a newer one cleared.
  Every Outlook claim but the catalog's skips a
  marked link (`l.mailbox_unavailable_at IS NULL`); give a new claim of work
  that calls Graph the same filter. Discovery stays claimed as the probe and
  waits as long as the link has been marked (30 s to 12 h). The catalog
  commit that finds the mailbox clears the mark and makes the link's
  streams, subscription upkeep (a new revision, failures reset) and settings
  work due at once. A reconnect (`email_service` `mailbox_init.rs`) clears
  it too, and with the same grant, which starts no new generation, makes
  the same work and discovery due itself; keep the two wakes alike. Any
  other discovery failure, a 5xx included, stays a provider error. The
  inbox's sync status reads `MailboxUnavailable`.
- Process deleted-user bindings in the domain by link id, custodian before
  owner, then actor id, retaining one binding per link and actor; the repository
  returns each binding's kind so custody cleanup runs before an owner disconnect
  can suppress it without processing a self-custodian twice.
- Outlook connect (`domain/mailbox/initialization.rs`) offers to share a
  connected mailbox only when its address has no account and its owner's
  account still exists; otherwise it re-homes the one link (`Rehome`) to the
  address's account, or the actor, and a previous owner who still has an
  account keeps an access edge. A link whose disconnect or purge has started,
  or another mailbox's link at the address whose owner's account is gone,
  answers `InboxBeingRemoved` (`INBOX_BEING_REMOVED`, 400) until it is gone.
  Gmail connect (`domain/mailbox/connection/gmail.rs`) never attaches to a
  departing link (removal started, or its owner's account gone): share,
  delegate and grant reconnect answer `InboxBeingRemoved` until the purge ends,
  and promotion rechecks under the link's row lock. A second Gmail link of the
  same mailbox can't stand in meanwhile: Gmail keeps one watch per mailbox,
  which the old link's teardown stops, and pushes reach one link per address.
- `email_links.fusionauth_user_id` is the holder of the credentials a link
  syncs with, not the inbox's owner (`macro_id`): another participant's
  connection or a custody transfer changes it. Never read it as ownership. A
  deleted user gets an owner binding only for an inbox of their own account.
- `email_mailbox_folders.total_item_count` is Graph's `totalItemCount` from the
  latest catalog discovery (every 5 minutes, from the listing discovery already
  makes), and the discover span sums it as `outlook.provider_item_count`. It
  counts what the folder holds at the provider, imported or not, so an import
  is checked against it. Deleted Items' count also covers any entries Graph
  lists but answers 404 for, so its stored messages can stay below it.
- `email_sync_streams.reader_revision` is the folder reader revision a mail
  folder stream's current delta round started at, and `round_started_at` when
  it started (the claim of its first page); `commit_page` writes both on the
  round's first page and `rebind_work` copies them. `domain/mailbox/reimport.rs`
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
