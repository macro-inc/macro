# macro_sha_count_client

## What it is

Part of document/file storage. Tracks references to content-addressed docx
parts (S3 objects keyed by SHA) in Postgres: `"BomPart"` rows are the
references, and released SHAs go to `sha_cleanup_queue` for
`sha_cleanup_worker`, which deletes an object once no row names it.

## Start here

- `src/lib.rs`: `ShaReferences::find_non_existing_shas(_string)` (which parts
  still need uploading) and `release_shas` (queue SHAs for cleanup).

## Scope

- Owns: the "is this part stored?" lookup and the `sha_cleanup_queue` writes.
- Not here: deleting the S3 objects (`services/sha_cleanup_worker`) or
  writing `"BomPart"` rows (`macro_db_client`).

## Boundaries

- Depends on: `model` (for `SaveBomPart`), Postgres.
- Used by: `documents`, `projects`, `document_storage_service`,
  `docx_unzip_handler`.

## Checks

- `cargo test -p macro_sha_count_client` (`SQLX_OFFLINE` unset; needs the
  local Postgres).

## Gotchas

- There is no counter to keep in sync: never add one back in Redis. The prod
  cache filled with `sha:` counters that never expired (2026-10-28).
- Release a document's SHAs whether you delete its rows before or after: the
  worker recounts `"BomPart"` before it deletes anything.

## Related

- `services/sha_cleanup_worker/AGENTS.md`
