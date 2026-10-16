# static_file_service (sfs)

## What it is

Shared infrastructure for file attachments across the product (documents,
email, chat). A deployable service for uploading, storing, and serving file
attachments: DynamoDB holds file metadata, S3 holds bytes, presigned URLs
handle upload.

## Start here

- `src/api.rs` + `src/api/context.rs`: router setup and shared `AppState`.
- `src/api/file/`: the HTTP surface — `put_presigned_url.rs` (upload),
  `get_file.rs`, `metadata.rs`, `delete_file.rs`, `bulk_delete_file.rs`.
- `src/api/event/`: S3 event handling (`s3_create.rs`, `s3_message.rs`) that
  marks a file uploaded once S3 confirms the object exists.
- `src/service/dynamodb/`: the DynamoDB item operations (`put_item.rs`,
  `get_item.rs`, `mark_uploaded.rs`, `delete_item.rs`).
- `src/service/s3/client.rs`: the S3 client wrapper.

## Scope

- Owns: file metadata (DynamoDB), file bytes (S3), presigned upload URLs, and
  the S3-event-driven "mark uploaded" transition.
- Not here: what entity a file is attached to (document, chat, etc.) — callers
  pass `models_sfs` references; this service doesn't know its callers' domains.

## Checks

- `cargo test -p static_file_service` (`SQLX_OFFLINE` unset).

## Gotchas

- A file is "pending" in DynamoDB until the S3 create event
  (`src/api/event/s3_create.rs`) marks it uploaded — a client finishing a
  presigned PUT does not itself update file state.
- `tree_trace` and `dynamodb_client_test` are test-only Cargo features; don't
  enable them in a deployed build.

## Related

- Rules: `.agents/rules/rust/guardrails.md`, `.agents/rules/rust/security.md`
