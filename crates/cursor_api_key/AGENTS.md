# cursor_api_key

## What it is

Part of agent sessions: a user's Cursor API key — KMS encryption (`cipher`)
and row storage (`store`) for the per-user secret `@cursor` sessions run
on. See the crate-level doc comment in `src/lib.rs` for the full threat
model.

## Boundaries

- Depends on: AWS KMS (via `aws-sdk-kms`).
- Used by: `agent_harness`, `authentication_service`, `agent_harness_service`.

## Recipes

- Change how a key is encrypted/decrypted: `src/cipher.rs` → its `test.rs`.
- Change how the ciphertext row is read or written: `src/store.rs` → its
  `test.rs` (uses `macro_db_migrator` as a dev-dependency).

## Checks

- `cargo test -p cursor_api_key` (`SQLX_OFFLINE` unset).

## Gotchas

- `cipher::CursorApiKey` redacts its `Debug` and zeroizes on drop; a decrypted
  key must become an HTTP header and be dropped, never held for a session's
  lifetime (see `src/lib.rs` threat model).
- Deleting a row does not revoke anything at Cursor — any "disconnect" surface
  must say so explicitly.

## Related

- Rules: `.agents/rules/rust/security.md`, `.agents/rules/rust/db.md`
