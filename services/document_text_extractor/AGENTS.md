# document_text_extractor

## What it is

Documents feature: Lambda that extracts text and citations from uploaded
documents (including PDF rendering via pdfium) and stores the result in
MacroDB, feeding search and citations elsewhere.

## Start here

- `src/handler.rs` + `src/handler/extract_text_citations.rs`: the SQS/EventBridge
  entry point and extraction logic.
- `src/service/s3.rs`, `src/service/db.rs`: S3 fetch and Postgres write adapters.
- `README.md`: local setup (cargo lambda, `.env`, sample invocations).

## Scope

- Owns: turning a stored document (PDF, etc.) into extracted plaintext/citations
  and persisting it; skips unopenable PDFs and deleted documents rather than
  retrying them.
- Not here: the document upload pipeline itself → `document_upload_finalizer_handler`.

## Recipes

- Change extraction behavior: `src/handler/extract_text_citations.rs` →
  `src/service/s3.rs` / `src/service/db.rs` as needed.
- Add a field read from the document key: `src/model/key.rs`.

## Checks

- `cargo test -p document_text_extractor` (`SQLX_OFFLINE` unset; needs local
  MacroDB — `just run_dbs`, `just initialize_dbs`).
- `just services/document_text_extractor/build` from the repo root for the
  deployable Lambda build (never build for deployment from this directory).

## Gotchas

- `pdfium-lib/` vendors the PDF rendering library; the `macos` feature switches
  `cargo lambda watch` to a Mac-compatible pdfium build for local runs.
- Build this crate's `local`/`local-extract` features only for local
  iteration — the deployed binary is built via the `just ... /build` recipe,
  not `cargo build` from this directory.
