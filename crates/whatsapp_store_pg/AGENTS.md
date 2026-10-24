# whatsapp_store_pg

## What it is

Part of WhatsApp linked devices: the Postgres implementation of every
`whatsmeow::store` trait for one linked account, with per-account envelope
encryption (KMS-wrapped data key, AES-256-GCM per value) and lease fencing.
The threat model is the crate doc comment in `src/lib.rs`.

## Start here

- `src/store.rs`: `PgWhatsAppStore::open`, fencing (`check_lease`) and the
  row helpers every store is built from.
- `src/cipher.rs`: the data key and value sealing (associated data =
  account | store | key).
- `src/kms.rs`: the KMS seam, the AWS impl, and the encryption context.

## Scope

- Owns: the `whatsapp_device`, `whatsapp_store_value`, `whatsapp_pre_key`,
  `whatsapp_app_state_mutation_mac`, `whatsapp_privacy_token`,
  `whatsapp_event_buffer` and `whatsapp_outgoing_event` tables
  (`crates/macro_db_client/migrations/20261024000200_whatsapp_store.sql`).
- Not here: the account, pairing and lease rows → linked-domain migration
  `20261024000000_whatsapp_linked.sql`; taking leases and running clients →
  `services/whatsapp_session_service`.

## Boundaries

- Depends on: `whatsmeow` (store traits), AWS KMS.
- Used by: the WhatsApp session service.

## Recipes

- Support a new whatsmeow store trait: a `StoreName` variant in
  `src/cipher.rs`, the impl in `src/store/<area>.rs`, tests in
  `src/store/<area>/test.rs`. Point and prefix lookups use
  `whatsapp_store_value`; a store that needs ordering, ranges or deletes by
  age gets its own table.

## Checks

- `cargo test -p whatsapp_store_pg` with `SQLX_OFFLINE` unset and
  `DATABASE_URL` on a database with the MacroDB migrations applied.
- `cargo clippy -p whatsapp_store_pg --all-targets --features fake-kms`

## Gotchas

- Every write goes through `begin_write` (fencing) and a value's key parts
  must match between `seal` and `open`, or it stops decrypting. Never move or
  rename a stored key without re-encrypting (see `move_signal_user`).
- Read-modify-write operations take `lock_device` (`FOR NO KEY UPDATE` on the
  device row); plain writes don't.
- `PgWhatsAppStore::seal(purpose, plaintext)` / `unseal(purpose, sealed)`
  encrypt blobs kept outside the store (e.g. media download locators) under
  the account's data key: `0x01 | nonce | ciphertext`, associated data
  `account | "sealed" | purpose`, so they never open as a store value or
  for another purpose or account.
- whatsmeow errors come back as `StoreError::Internal`; use `is_fenced` to
  detect a lost lease.
- `fake-kms` exposes `FakeWhatsAppKms` for other crates' tests; never enable
  it in a binary.
- Deleting the device row deletes the keys; it does not unlink the device at
  WhatsApp.

## Related

- Rules: `.agents/rules/rust/security.md` (CS-72), `.agents/rules/rust/db.md`
