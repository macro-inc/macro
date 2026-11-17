# password_events

## What it is

Kafka event models for the `macro.passwords` topic: committed vault facts
addressed to one account, such as the resolution of an agent's access request.

## Scope

- Owns: `PasswordTopicEvent` and its metadata, keyed by the addressed user.
- Not here: the outbox and publishing (document_storage_service, from the
  `passwords` outbox), webhook and SSE delivery → `crates/webhook`.

## Boundaries

- Depends on: `macro_event_broker`, `macro_event_topics`, `macro_user_id`.
- Used by: `document_storage_service`, `webhook`.

## Checks

- `cargo test -p password_events --all-features`

## Gotchas

- `event_type` names are public webhook event names; renaming one breaks
  SDK and webhook consumers.
- Events are refresh hints, never grants or secret material. The routing
  `recipient_user_id` is stripped before webhook delivery.
