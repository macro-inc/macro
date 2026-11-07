# chat_id

## What it is

Shared type for AI chat: `ChatId`, the `TEXT` id of a chat, as a `nutype`
String newtype (CS-10).

## Boundaries

- Depends on: `nutype`; `sqlx` and `utoipa` behind the `sqlx` and `schema`
  features.
- Used by: `chat` (`MessageService`), `agent_harness_service`.

## Checks

- `cargo test -p chat_id --all-features`

## Gotchas

- Not validated: stored ids are usually UUID strings but need not be, so
  parsing would reject real data.
- AI chats only; channel messages and their threads have their own ids.
