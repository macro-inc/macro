# microsoft_oauth_grant_db_utils

## What it is

Compatibility helpers for encrypted Microsoft OAuth envelopes in the legacy
`microsoft_oauth_grants` table, keyed by owner and normalized email address.

## Scope

- Owns: atomic storage and retrieval of opaque encrypted envelopes.
- Keep encryption, decryption, authorization, and OAuth policy in the caller.
- Staged grant versions and refresh leases belong to
  `services/authentication_service/src/outbound/microsoft/`.
- Schema changes belong in `../macro_db_client/migrations/`.

## Checks

- Run `cargo test -p microsoft_oauth_grant_db_utils` with `SQLX_OFFLINE` unset
  and a migrated local database.
- Run `just check` for code changes.

## Gotchas

- Keep the schema test's explicit column allowlist aligned with migrations;
  review new columns to preserve the encrypted-only secret storage boundary.
- Preserve the complete envelope when replacing a grant; its ciphertext, data
  key, nonce, encryption version, and KMS key identifier belong together.

## Related

- [Database guide](../../docs/development/database.md)
- [Outlook design](../../docs/design/outlook-email-support.md)
