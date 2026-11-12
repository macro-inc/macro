# kms_envelope

## What it is

Envelope encryption for secrets kept in Postgres: one KMS-wrapped data key per
scope (a WhatsApp or Slack account, a Slack sign-in attempt) and AES-256-GCM
sealing under it. The threat model is the crate doc comment in `src/lib.rs`.

## Start here

- `src/kms.rs`: the `EnvelopeKms` seam, `AwsKms`, `encryption_context`.
- `src/cipher.rs`: `DataKey`, `ValueCipher` (`seal`/`open` for nonce + value
  columns, `seal_blob`/`open_blob` for one column).

## Boundaries

- Depends on: AWS KMS.
- Used by: `whatsapp_store_pg`, `slack_linked`, the Slack and WhatsApp session
  services.

## Checks

- `cargo test -p kms_envelope`

## Gotchas

- The associated-data layout (scope bytes, then each label length-prefixed as
  a big-endian u32) and the blob format (`0x01 | nonce | ciphertext`) are what
  stored WhatsApp and Slack ciphertexts were written with; changing either
  makes them unreadable. A test pins the layout.
- Build each feature's encryption context in one function; a context that
  differs at all is a key nothing can unwrap again. Use a distinct `purpose`
  per use so IAM can condition on `kms:EncryptionContext:macro:purpose`.
- `fake` exposes `FakeKms` for other crates' tests; never enable it in a
  binary.

## Related

- Rules: `.agents/rules/rust/security.md`
