# static_file_service_client

## What it is

Shared infrastructure for attachments and uploads — the HTTP client for the
static file service (SFS): put, get, and delete a file by key over
internal-auth-key-authenticated requests.

## Start here

- `src/lib.rs`: `StaticFileServiceClient`, constructed with the internal auth
  key and base URL; sets `x-internal-auth-key` on every request.
- `src/put_file.rs`, `src/get_file.rs`, `src/delete_file.rs`: one request each.

## Scope

- Owns: the raw HTTP contract with the static file service.
- Not here: deciding what gets uploaded or how a static file reference is
  modeled for a feature → `crates/static_file`, `crates/attachment`.

## Boundaries

- Depends on: `models_sfs`, `macro_aws_config`, `reqwest`.
- Used by: `services/document_storage_service`, `services/agent_harness_service`,
  `services/email_service`, `crates/channels`, `crates/cursor_cloud_agents`,
  `crates/ai_tools`, `crates/image_generation`.

## Recipes

- Add a new SFS endpoint: new `src/<verb>_file.rs` → `pub mod` in `src/lib.rs`
  → method on `StaticFileServiceClient`.

## Checks

- `cargo test -p static_file_service_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
