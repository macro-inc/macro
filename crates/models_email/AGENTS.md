# models_email

## What it is

Part of the Email feature. Wire models for email and Gmail sync:
thread/message API types, DB row types, and Gmail API response shapes.

## Start here

- `src/email/mod.rs` → `api`, `db`, `service`: the three-layer email model
  split (API-facing, DB row, service-layer), mirroring `models_properties`.
- `src/gmail.rs` + `src/gmail/`: Gmail API response types — `contacts.rs`,
  `filters.rs`, `history.rs`, `inbox_sync.rs`, `labels.rs`, `gmail_ops.rs`,
  `operations.rs`.

## Scope

- Owns: email/Gmail wire and DB-row models shared across email services.
- Not here: calendar sync (moved out, see `#6826`) → `calendar_events`;
  actual IMAP/SMTP or Gmail API calls → `email_service`, `gmail_client`.

## Boundaries

- Depends on: `email_utils`, `macro_user_id`, `models_pagination`.
- Used by: `ai_tools`, `calendar_service`, `email_api_client`, `email_db_client`,
  `email_refresh_handler`, `email_scheduled_handler`, `email_service(_client)`,
  `gmail_client`, `search_processing_service`, `search_service`, `sqs_client`,
  `teams`.

## Checks

- `cargo test -p models_email` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
