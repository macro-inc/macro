# macro_sha_count_client

## What it is

Part of document/file storage. Queues content-addressed docx parts (S3
objects keyed by SHA) for garbage collection: `"BomPart"` rows are the
references, and released SHAs go to `sha_cleanup_queue` for
`sha_cleanup_worker`, which deletes an object once no row names it.

## Start here

- `src/lib.rs`: `ShaReferences::release_shas` (queue SHAs for cleanup).

## Scope

- Owns: the `sha_cleanup_queue` writes.
- Not here: "is this part uploaded?" — callers ask S3 with `HeadObject`
  (DSS presave, `docx_unzip_handler`); deleting the S3 objects
  (`services/sha_cleanup_worker`); writing `"BomPart"` rows
  (`macro_db_client`).

## Boundaries

- Depends on: Postgres.
- Used by: `documents`, `projects`, `document_storage_service`.

## Checks

- `cargo test -p macro_sha_count_client` (`SQLX_OFFLINE` unset; needs the
  local Postgres).

## Gotchas

- There is no counter to keep in sync: never add one back in Redis. The prod
  cache filled with `sha:` counters that never expired (2026-10-28).
- Never answer "is this part uploaded?" from `"BomPart"` or any other proxy:
  only S3 knows, and a row can outlive or predate its object.
- Release a document's SHAs whether you delete its rows before or after: the
  worker recounts `"BomPart"` before it deletes anything.

## Related

- `services/sha_cleanup_worker/AGENTS.md`
