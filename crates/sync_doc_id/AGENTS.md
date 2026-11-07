# sync_doc_id

## What it is

The shared sync-service key for document and collaborative-surface sessions.
It accepts nonempty opaque strings verbatim and serializes as a JSON string.

## Boundaries

- Depends on `document_id` for the consuming `From<DocumentId>` conversion.
- A sync key is not necessarily a document UUID; preserve surface and legacy keys.
- Owns no networking, storage, clocks, ID generation, or connection state machine.
- Keep this flat leaf excluded from hakari; no workspace-hack dependency.

## Checks

- `cargo test -p sync_doc_id`
- `cargo check -p sync_doc_id --target wasm32-unknown-unknown`
- `cargo clippy -p sync_doc_id --all-targets -- -D warnings`
- `cargo tree -p sync_doc_id --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`
