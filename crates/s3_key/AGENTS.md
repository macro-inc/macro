# s3_key

## What it is

Part of shared infrastructure (cloud storage). S3 key building and
parsing for every cloud-storage bucket Macro uses: documents, bulk
uploads, Slack imports, and static files.

## Start here

- `src/document_key.rs` (425 lines, the largest): `DocumentKey`, conversion
  and upgrade key builders, and the sync-service snapshot prefix — read this
  one first, the others follow its pattern.
- `src/bulk_upload_key.rs`, `src/slack_import_key.rs`, `src/static_file_key.rs`:
  one key type per bucket/use case, each with its own parse/build pair.

## Scope

- Owns: how an owner/entity id maps to an S3 key string, and parsing a key
  back into its typed parts.
- Not here: the bucket name itself (service config) or the S3 calls → `s3_client`.

## Boundaries

- Depends on: `model_owner` (owner segment encoding).
- Used by: `documents`, `dynamodb_client`, `projects`, `slack_integration`,
  `sqs_client`.

## Recipes

- Add a key type for a new bucket/use case: new `src/<name>_key.rs` (build +
  parse + roundtrip test) → `pub use` it from `src/lib.rs`.

## Checks

- `cargo test -p s3_key` (`SQLX_OFFLINE` unset).

## Gotchas

- The owner segment is an encoded principal string, not a raw id — see
  `build_cloud_storage_bucket_document_key`; don't hand-roll owner encoding.

## Related

- Rules: `.agents/rules/rust/code.md` (CS-10 newtype ids)
