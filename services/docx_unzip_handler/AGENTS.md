# docx_unzip_handler

## What it is

Documents feature: Lambda that unzips uploaded `.docx` files from S3 and
converts their XML parts into a Bill Of Materials (BOM) stored in MacroDB.

## Start here

- `src/handler.rs`: S3 event entry point — loops over records, resolves bucket/key.
- `src/service/document.rs`: pipeline — `unzip` → `process` (BOM parts) →
  `upload_bom_parts`, with `handle_docx_unzip_failure` for error notification.
- `README.md`: local setup, `make build`, and the manual invoke payload.

## Scope

- Owns: unzipping `.docx` archives and extracting their parts into the BOM
  representation; notifying on unzip failure.
- Not here: the upload-finalize step that triggers this (file type detection,
  legacy format upgrade) → `document_upload_finalizer_handler`.

## Recipes

- Add a new BOM part type: `src/service/document/bom_parts.rs` (or sibling
  module under `src/service/document/`) → `src/service/document.rs` re-export.
- Change failure handling: `src/service/document/notify_docx_upload_job.rs`.

## Checks

- `cargo test -p docx_unzip_handler` (`SQLX_OFFLINE` unset; needs local MacroDB
  — `just run_dbs`, `just initialize_dbs`, plus `CREATE EXTENSION IF NOT EXISTS
  "uuid-ossp";` per the README's one-time setup).
- `nix develop --command just prepare_db` from the repo root after schema/query changes, before `make build`.

## Gotchas

- Do not build this crate for deployment from this directory — use the repo's
  Lambda build path (`make build` here targets the Lambda release artifact).
