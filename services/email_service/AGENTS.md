# email_service

## What it is

Email feature: deployable service hosting Gmail sync, email send/schedule/
draft routes, calendar invitation handling, and contacts/CRM sync, behind
the gateway `/email` prefix.

## Start here

- `src/main.rs` / `src/lib.rs`: entrypoint and `run()`.
- `src/api.rs` + `src/api/context.rs`: HTTP surface and `ApiContext`.
- `src/pubsub/`: SQS pubsub workers, one module per concern — `inbox_sync`,
  `link_manager` (Gmail re-subscribe, health checks, inbox deletion),
  `scheduled` (scheduled sends),
  `sfs_uploader`/`sfs_deleter` (attachment storage), `gmail_ops`, `backfill`,
  `crm_cleanup`, `worker_lifecycle`.
- `src/backfill_outbox.rs`, `src/backfill_init_service.rs`,
  `src/backfill_completion_service.rs`: Gmail history backfill orchestration.
- `src/crm_enrichment_worker.rs`: periodic pass that resolves pending CRM
  company directory entries (names/logos) left by binaries without a resolver.
- `src/bin/`: standalone binaries — `pubsub_workers` (the queue consumer
  process), plus one-off backfill/cleanup scripts.

## Scope

- Owns: Gmail/email API routes, email-side calendar invitation handling,
  contacts sync, and all `src/pubsub/` queue consumers listed above.
- Not here: Google Calendar sync itself → `crates/calendar_events`,
  `calendar_service`; scheduled-send and SFS-cleanup *triggering* (cron) →
  `email_scheduled_handler`, `email_sfs_delete_handler`, `email_refresh_handler`
  (this service consumes the queues they publish to).

## Recipes

- Add an email API route: `src/api/email.rs` (or `src/api/gmail.rs`,
  `src/api/calendar_invitations.rs`, `src/api/calendar_event_forward.rs`) →
  `src/api/context.rs` → `src/api/swagger.rs`.
- Add a pubsub consumer: new module under `src/pubsub/` → wire into
  `src/pubsub/mod.rs` and the `pubsub_workers` binary.
- Add a backfill step: `src/backfill_init_service.rs` →
  `src/backfill_completion_service.rs` → `src/backfill_outbox.rs`.

## Checks

- `cargo test -p email_service` (`SQLX_OFFLINE` unset; the `label_write_sim`
  tests also need Redis, at `REDIS_URI` or `redis://127.0.0.1:6379`).
- `just check` (from this directory) runs `cargo check` with `SQLX_OFFLINE=true`.
- Local SQS: `just create-localstack` / `create-queues` before running
  `pubsub_workers` locally; queue names are in the `justfile`.

## Gotchas

- Provider-sync deletions deferred by active sends publish no deletion event; scheduled recovery reconciles the retained marker before trying to claim delivery.

- Draft edit routes carry `draft_generation` from the editing lifetime, including attachments, deletion, transfer, and schedules; regenerate OpenAPI clients when this contract changes.

- The Gmail delivery adapter freezes approved upload/provider-file IDs before
  loading bytes through the authorized reader; Outlook uses its own coordinator.

- Forwarded attachments use the source inbox's provider credentials; the email
  domain rechecks the scheduled actor's access before cross-inbox downloads.
- Macro's own digest emails are filtered out of Signal/email notifications
  (#7039) — don't reintroduce a path that notifies on our own sends.
- Long attachment names are truncated to the DSS limit before upload (#7893);
  don't remove that truncation when touching `util/upload_attachment.rs`.
- Scheduled Gmail sends recheck forwarded source inbox access before resolving
  attachment bytes through the provider-aware reader.
- Preserve the calendar domain's `team_ooo_changed` hint when forwarding a
  calendar refresh so unrelated invitation updates retain teammates' OOO rows.
- Spawn `run_transfers` regardless of the Outlook flags. Gmail inbox moves
  finish there; with writes off it pauses only the Outlook retire step.
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
  (`pubsub/backfill/deferral.rs`), because waiting out the visibility timeout
  would spend the queue's 20 deliveries.
  Inbox sync releases the upload claims of a refused attachment fetch and
  requeues the upsert, because a claimed attachment is never offered again.
- BackfillThread reads a whole thread with one Gmail `threads.get` and writes
  the thread row and all of its messages in one transaction
  (`insert_backfilled_thread`), so a failed write leaves nothing for a retry
  to skip. Each message has its own savepoint: one whose data can never be
  stored (`db_error::is_unstorable`) is skipped and logged, and the rest of the
  thread commits. The CRM fan-out is enqueued after the write slot is taken
  and before the write: after the commit nothing in the handler may request a
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
- Gmail label writes leave a marker in `email_gmail_pending_label_writes`.
  Inbox sync keeps the local state of a label marked before or after it reads
  Gmail (`inbox_sync::operations::pending_labels`); a re-sync or recovery
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
- Local stacks run debug workers on tokio's 2 MiB worker stacks, where every
  awaited future takes its own stack slot. Pass a Gmail call through a helper
  as a `BoxFuture`, and box an operation the dispatch awaits in several arms;
  a `label_write_sim` test runs the label paths on 1.5 MiB worker stacks.
- gmail_ops moves transient Gmail failures to the retry queue like rate limits;
  the primary queue dead-letters after three receives.
- Header addresses that Gmail accepts can fail `MacroUserIdStr::try_from_email`.
  Skip the bad address with a WARN that omits it (the parse error echoes it)
  instead of failing the step; see `pubsub::util::build_contact_connections`.
- The `link_manager` worker receives one message at a time and renews its
  visibility while processing. Don't raise its receive batch: messages queued
  behind a long mailbox purge would be redelivered and purged twice.
  `PurgePacing` (`email_db_client::links::delete`) sets the purge's write rate.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `new-service`
