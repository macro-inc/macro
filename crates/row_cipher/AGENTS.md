# row_cipher

## What it is

Shared by integration syncs (Granola, Dialpad): AES-256-GCM for a secret Macro
generated and stores in one row, bound to that row's id so a copied
ciphertext does not decrypt elsewhere.

## Scope

- Owns: sealing and opening service-generated secrets such as webhook
  signing secrets.
- Not here: user or third-party credentials (OAuth tokens, API keys) → KMS
  ciphertext per CS-72 (`crates/cursor_api_key` pattern, or Macro Connect).

## Boundaries

- Used by: `granola_sync`, `dialpad_sync` (both under the harness MCP
  credentials key).

## Checks

- `cargo test -p row_cipher`

## Gotchas

- The stored format is `nonce (12 bytes) || ciphertext`; existing Granola rows
  use it, so never change it in place.
