# entity_basic_types

## What it is

Shared types: the `DocumentBasic`, `ChatBasic` and `BasicProject` rows that
db queries load and `entity_access`'s axum extractors read from request
extensions. Split out of `model` so `entity_access` does not depend on it.

## Scope

- Owns: those three structs and `DocumentBasic::try_file_type`.
- Not here: richer document/chat/project models → `crates/types/shared_types`.

## Boundaries

- Depends on: `model_owner`, `model_file_type`, `document_sub_type` only.
- Used by: `model` (re-exports at the old paths), `entity_access`.

## Gotchas

- `model` re-exports these with the `sqlx` and `schema` features on; crates
  that derive OpenAPI or run `query_as!` into them need the same features.

## Checks

- `cargo check -p entity_basic_types --all-features`
