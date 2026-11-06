# s3_client

## What it is

Part of shared infrastructure (cloud storage). Thin async wrapper around
`aws-sdk-s3`: get/put/delete/exists/copy, folder variants, and presigned
URLs, all behind one `S3` struct.

## Start here

- `src/lib.rs`: the `S3` struct — every public method is a one-line delegate
  to its sibling module (`get.rs`, `put.rs`, `delete.rs`, `copy.rs`,
  `exists.rs`, `get_folder.rs`).

## Scope

- Owns: a generic S3 operation surface, independent of bucket/key semantics.
- Not here: what a bucket key looks like for a given entity → `s3_key`.

## Boundaries

- Used by: `convert_service`, `dataloss_prevention_handler`,
  `docx_unzip_handler`, `email_service`, `search_processing_service`.

## Recipes

- Add an operation: new `src/<op>.rs` (free function taking
  `&aws_sdk_s3::Client`) → a delegating method on `S3` in `src/lib.rs` with
  `#[tracing::instrument(skip(self))]`.

## Checks

- `cargo test -p s3_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/code.md` (CS-22 on `#[tracing::instrument]`)
