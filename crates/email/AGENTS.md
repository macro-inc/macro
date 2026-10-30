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
  draft attachments (feature `s3`).

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
  `calendar_events` (optional, feature `calendar_invitations`).
- Used by: many crates and services, including `ai_tools`, `graphql_email`,
  `teams`, `databases_sql`, `work_feed`, `calendar_service`, `email_service`,
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

- Reconcile deferred message deletion before claiming scheduled work; unresolved sends retain their message, attachments, and delivery job.
- Durable send admission supports Gmail and Outlook; Outlook delivery stays with its provider coordinator.
- Carry the captured `draft_generation` through every draft mutation; advance it on send acceptance/cancellation under the message lock and preserve attempt tombstones after message deletion.

- Gmail thread label writes stage each thread's DB change, then enqueue one
  provider write per inbox holding only the messages whose labels changed
  (`stage_thread_labels` / `commit_thread_label_write` in
  `domain/service/thread_labels.rs`); route new label actions through them.
- `.eml` downloads go through `domain/message_source.rs`, which authorizes like
  attachment reads and fetches the provider's original RFC 822 bytes (Gmail
  `format=raw`, Graph `$value`); drafts and unsynced messages have no source.
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
- Sender discovery authorizes the inbox first. Gmail aliases use the sender
  provider; Outlook exposes its verified primary address without a Gmail lookup.
- Outlook links have no system label rows. Move a thread in or out of the inbox
  through `set_thread_inbox`, and read Outlook inbox, trash, and junk state from
  `email_message_mailbox_facts`, never from labels.
- Outlook organization commands only run in their link's current
  `sync_generation`. Anything that bumps it must rebind unfinished commands as
  `pending`, since claims skip `confirming` ones while those still block later
  commands, as reconnect (`email_service` `mailbox_init.rs`) and `rebind_work` in
  `outbound/mailbox_pg/lifecycle.rs` do; thread operations omit older generations.

## Related

- Rules: `.agents/rules/rust/architecture.md`
