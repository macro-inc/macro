# document_id

## What it is

Shared type for documents: `DocumentId`, a validated document id. It is
String-backed because historical document ids need not be UUIDs; validation
rejects empty, whitespace-padded and control-character strings.

## Boundaries

- Depends on: `serde`, `thiserror`; `utoipa` behind `schema`, `schemars`
  behind `json-schema`.
- Used by: `message_parent` (which re-exports it for `MessageParent::Document`)
  and `documents` (`DocumentContentEventService`).

## Checks

- `cargo test -p document_id --all-features`

## Gotchas

- The doc comment on `DocumentId` is the published OpenAPI and JSON-schema
  description; changing it changes the API schema.
- Most `document_id` fields are still raw `String`/`&str`; parse with
  `DocumentId::parse` and read with `as_str` at the boundary until they move.
- `agent_session::TaskDocumentId` is a narrower type (task documents, UUID
  form); keep it separate.
