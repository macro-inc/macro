# email_thread_id

## What it is

Shared type for Email: `EmailThreadId`, the id of an email thread row Macro
stores, a `uuid_id!` newtype (CS-10).

## Boundaries

- Depends on: `id_newtype`; `sqlx` and `utoipa` behind the `sqlx` and
  `schema` features.
- Used by: `email` (`EmailService` thread methods).

## Checks

- `cargo test -p email_thread_id --all-features`

## Gotchas

- Not the provider's thread id (Gmail/Outlook), which is a string.
- Most `thread_id` fields are still raw `Uuid`; convert at the boundary with
  `EmailThreadId::from_uuid` / `into_uuid`.
