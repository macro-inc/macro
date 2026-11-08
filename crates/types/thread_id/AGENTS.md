# thread_id

## What it is

Shared type for messaging: `ThreadId`, the id of a message thread (the id of
the message its replies answer), a `uuid_id!` newtype (CS-10) that serializes
as the UUID string.

## Boundaries

- Depends on: `id_newtype`; `sqlx` and `utoipa` behind the `sqlx` and
  `schema` features.
- Used by: `channels` (`ChannelRepo::get_thread_participants`,
  `ChannelSideEffectContext::get_thread_notification_context`) and their
  adapters in `channels_outbound`.

## Checks

- `cargo test -p thread_id --all-features`

## Gotchas

- Email threads are a different id: use `email_thread_id::EmailThreadId`.
- Most `thread_id` fields are still raw `Uuid`; convert at the boundary with
  `ThreadId::from_uuid` / `as_uuid` until they move over.
