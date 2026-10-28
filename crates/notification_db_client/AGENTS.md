# notification_db_client

## What it is

Part of the notifications feature. Query-only client for the notification
tables in MacroDB: devices, user notifications, email-sent/unsubscribe
records, and mute state.

## Start here

- `src/lib.rs`: the module list — one module per table
  (`notification/`, `device.rs`, `user_notification/`,
  `notification_email_sent/`, `unsubscribe/`, `user_mute_notification.rs`,
  `email_unsubscribe_code.rs`, `channel_notification_email_sent/`).
- `fixtures/*.sql`: seed data each module's tests build on.

## Scope

- Owns: the `sqlx::query!` call sites for notification-related tables.
- Not here: the tables' schema/migrations → `crates/macro_db_client/migrations`
  (search for `create_notification_tables`); notification business logic →
  `notification`.

## Boundaries

- Depends on: `model_notifications`, `model-entity`, `models_pagination`.
- Used by: `notification`, `services/notification_service`.

## Recipes

- Add a query to an existing table: the module in `src/<table>/` → its tests
  → `nix develop --command just prepare_db` from the repo root if SQLx cache
  metadata is missing.
- Add a new table: migration in `crates/macro_db_client/migrations` first →
  new module here, `pub mod` it in `src/lib.rs`.

## Checks

- `cargo test -p notification_db_client` (`SQLX_OFFLINE` unset; requires
  local MacroDB — `just setup_macrodb`).

## Related

- Rules: `.agents/rules/rust/db.md` · Docs: `docs/development/database.md`
