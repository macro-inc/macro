# email_db_client

## What it is

Part of the Email feature: the SQLx query crate for MacroDB's email tables —
messages, threads, contacts, labels, links, attachments, sync tokens, CRM
cleanup, and backfill.

## Start here

- `src/lib.rs`: the module list, one per table/feature area, mirroring
  `macro_db_client`'s layout.
- `src/parse/`: service↔DB type conversion (`db_to_service.rs`,
  `service_to_db.rs`) and column-length limits (`column_limits.rs`).
- `README.md`: local test-database setup.

## Scope

- Owns: the `sqlx::query!` call sites for email tables.
- Not here: email domain/business logic → `crates/email`; provider API calls
  → `email_api_client`. The schema lives in `crates/macro_db_client/migrations/`
  (shared MacroDB), not here.

## Boundaries

- Depends on: `models_email`, `models_pagination`, `email_utils`.
- Used by: `crates/email`, `crates/search_service`, `services/calendar_service`,
  `services/authentication_service`, `services/search_processing_service`,
  `services/email_service`.

## Recipes

- Add a query to an existing table: the module in `src/<area>/` (e.g.
  `src/messages/get.rs`) → its `mod.rs` → a fixture under `fixtures/*.sql` if
  the test needs seed data.
- Add a column or table: see `crates/macro_db_client/AGENTS.md` (this crate
  only owns queries, not migrations).

## Checks

- `cargo test -p email_db_client` (`SQLX_OFFLINE` unset; requires local
  MacroDB — `just setup_macrodb`).

Parsed message responses expose the draft generation captured in the same SQL snapshot as their content.

## Gotchas

- Message deletion may return `Deferred` while an accepted send owns the row; reconcile retained deletions under the message lock and compare both provider identity and draft generation.
- Resolve provider deletions with `get_simple_message_by_provider_and_link_for_update` inside the deletion transaction; retain the message lock through cleanup and deletion so Send completion or Undo cannot invalidate the snapshot.

- Scheduled delivery and durable Send share `email_draft_provider_attachment_ids`
  for native/forwarded identities, honoring removals and copied-upload deduplication.

- Forwarded-attachment delivery reads preserve `source_link_id` from the original
  message; the destination draft inbox is only the query access scope.
- `insert_message_with_tx` leaves labels with an unexpired
  `email_gmail_pending_label_writes` marker, and the read and starred flags
  they drive, in their local state when it re-syncs a stored message. Given a
  `ResyncSnapshot` from before the Gmail fetch, it changes only labels where
  Gmail disagrees with that snapshot, so a write made during the fetch stays.
- `email_gmail_pending_label_writes` keeps one row per write on a message's
  label, newest by `seq` (staging order, which write ids need not follow).
  Only the newest row's write sends; older ones wait while a newer row hasn't
  expired, so abandoning a write can put the label back for the newest older
  write whose row hasn't expired (`label_present`) or the state before it
  (`label_present_before`, passed on by older writes given up). Code that
  stages, confirms or abandons a Gmail label write takes
  `lock_thread_label_writes` for its threads first.
- Quote and alias camelCase columns to Rust field names; check
  `crates/macro_db_client/migrations/` for real column spelling, don't guess.
- A Macro draft (no provider id, or a live `email_mailbox_drafts` row) puts its
  thread in the inbox only when `email_threads.has_received_mail` is true.
  `recompute_thread_metadata` and the email crate's
  `thread_mail_projections_by_ids` restate this rule; change both together.

## Related

- Rules: `.agents/rules/rust/db.md` · Docs: `docs/development/database.md`
