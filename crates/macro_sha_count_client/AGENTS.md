# macro_sha_count_client

## What it is

Part of document/file storage. A Redis-backed reference counter for
content-addressed file blobs (SHA keys), used to know when a blob's last
reference is gone and it's safe to delete.

## Start here

- `src/lib.rs`: `Redis::increment_counts` / `release_shas` (decrement) /
  `sha_exists` / `find_non_existing_shas(_string)`.
- `src/increment_count.rs`, `src/decrement_count.rs`, `src/exists.rs`: the
  underlying Redis operations.

## Scope

- Owns: reference counting for file content SHAs and the `bucket:sha-delete`
  tracking used to find SHAs ready for cleanup.
- Not here: actually deleting the underlying blob storage — this crate only
  tracks the reference count.

## Boundaries

- Depends on: `model` (for `SaveBomPart`).
- Used by: `documents`, `projects`, `document_storage_service`,
  `docx_unzip_handler`.

## Checks

- `cargo test -p macro_sha_count_client` (`SQLX_OFFLINE` unset).

## Gotchas

- `release_shas` collapses a list with duplicate SHAs into per-SHA counts
  before decrementing (`reference_counts`) — releasing the same SHA twice in
  one call removes two references, not one, so callers must pass every BOM
  reference, not a deduplicated set.

## Related

- Skill: `dump-schema` (if cross-checking against `document.save_bom_part`)
