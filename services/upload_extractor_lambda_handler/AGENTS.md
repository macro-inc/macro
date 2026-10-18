# upload_extractor_lambda_handler

Unpacks folder uploads from S3, builds the uploaded file tree, and submits files
and folders to native document storage. Queue orchestration stays in `src/main.rs`;
`src/archive.rs` owns local ZIP extraction.

## Checks

- `cargo test -p upload_extractor_lambda_handler` with SQLX_OFFLINE unset.
- `src/archive/test.rs` covers normal extraction, escaping symlinks and special
  Unix permission bits. Keep the malicious attributes in the archive bytes;
  the ZIP writer sanitizes permission options before writing.

## Gotchas

Use the ZIP library's confined extraction defaults. Never relax link/permission
validation or restore privileged archive modes after extracting an upload.
