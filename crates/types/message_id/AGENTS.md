# message_id

## What it is

Shared type for messaging: `MessageId`, the id of a message in a channel,
document discussion or other message parent, a `uuid_id!` newtype (CS-10)
that serializes as the UUID string.

## Boundaries

- Depends on: `id_newtype`; `sqlx` and `utoipa` behind the `sqlx` and
  `schema` features.
- Used by: `messages` (`MessageRepository`'s single-message methods) and its
  Postgres adapter.

## Checks

- `cargo test -p message_id --all-features`

## Gotchas

- A thread is keyed by its root message's id but has its own type,
  `thread_id::ThreadId`; convert explicitly when crossing between them.
- Email message ids (`notification`'s digest `MessageId(String)`) and the
  agent fold's `MessageId` are unrelated types.
- Most `message_id` fields are still raw `Uuid`; convert at the boundary with
  `MessageId::from_uuid` / `as_uuid` until they move over.
