# model

## What it is

Shared infrastructure underlying Documents, chat, and authentication. Core
wire/domain models for documents, items, chat, projects, threads, and
authentication — one of the most widely depended-on crates in the backend.

## Start here

- `src/document.rs` + `src/document/`: document models, `DocumentFamily`,
  file type, listing, and API responses.
- `src/item.rs` + `src/item/map_item.rs`: the generic item abstraction shared
  across documents/folders/projects.
- `src/chat.rs`, `src/thread.rs`, `src/project.rs`: chat, thread, and project
  models.
- `src/authentication/`: user, permission, and Google token models.
- `src/annotations.rs`: PDF/document annotation create/edit/delete payloads.

## Scope

- Owns: the shared request/response and storage-facing models for documents,
  items, folders, projects, chat, threads, annotations, and authentication.
- Not here: message/discussion models → `messages`; typed ownership →
  `model_owner`; entity permissions → `models_permissions`; properties →
  `models_properties`.

## Boundaries

- Depends on: `model-entity`, `model_owner`, `model_file_type`, `model_user`,
  `models_permissions`, `models_pagination`, `models_bulk_upload`.
- Used by: dozens of services and crates — `agent_harness`, `ai_tools`,
  `authentication_service(_client)`, `chat`, `collab_surface`,
  `document_storage_service(_client)`, `documents`, `email_service(_client)`,
  `entity_access`, `macro_db_client`, `messages`, `models_soup`, `projects`,
  `search_service`, `sync_service_client`, and more — check reverse
  dependents before changing a public type's shape.

## Recipes

- Add a document-facing field: `src/document.rs` or `src/document/response.rs`
  → callers in `document_storage_service`, `documents`.
- Add an annotation operation: `src/annotations.rs` → `src/annotations/{create,edit,delete}.rs`.

## Checks

- `cargo test -p model` (`SQLX_OFFLINE` unset).

## Gotchas

- This crate is a shared dependency for most of the backend; a breaking
  change to a public struct ripples widely — grep reverse dependents first.

## Related

- Rules: `.agents/rules/rust/architecture.md`
