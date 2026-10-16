# user_api_key

## What it is

Part of account security — creates, lists, and deletes a user's API keys.
Authenticating a request *with* a key lives in `macro_authorization`, not
here.

## Start here

- `src/domain/service.rs`: create/list/delete operations.
- `src/outbound/pg_user_api_keys_repo.rs`: the `"UserApiKey"` table repository
  (feature `postgres`); also exposes lookup-by-key for `macro_authorization`.
- `src/inbound/axum_router.rs` (feature `inbound`): HTTP routes.

## Scope

- Owns: the `"UserApiKey"` table's lifecycle.
- Not here: validating the `x-macro-user-api-key` header on an incoming
  request → `macro_authorization`.

## Boundaries

- Depends on: `macro_user_id`, `macro_authorization` (feature `inbound`).
- Used by: `services/document_storage_service`.

## Checks

- `cargo test -p user_api_key` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/security.md`
