# message_parent

Part of messages: `MessageParent`, the entity a message belongs to (channel,
document, project, CRM record, call), plus its validated `DocumentId`. A leaf
type crate so crates that only name a parent, such as `lexical_client`, don't
depend on the `messages` domain.

## Scope

- Owns: parsing and canonical `entity_type`/`entity_id` strings for message
  parents, and their serde form (`{"type": ..., "id": ...}`).
- Not here: message storage, threads, anchors → `crates/comms/messages`.

## Boundaries

- Depends on: `entity_kind` (for `access_entity_type`), serde, uuid.
- Used by: `messages` (re-exported as `messages::domain::models::MessageParent`),
  `lexical_client`.

## Checks

- `cargo test -p message_parent`

## Gotchas

- The serde and utoipa forms are wire format for DSS and the web app; keep
  `schema`/`json-schema` derives behind their features, as `messages` enables
  them.
