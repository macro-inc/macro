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
- Quote and alias camelCase columns to Rust field names; check
  `crates/macro_db_client/migrations/` for real column spelling, don't guess.

## Related

- Rules: `.agents/rules/rust/db.md` · Docs: `docs/development/database.md`
