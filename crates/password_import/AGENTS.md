# password_import

## What it is

Passwords import: parses 1Password and Bitwarden exports into items the team
vault (`crates/passwords`) accepts. Runs in the browser as wasm, so the raw
file never leaves the device.

## Start here

- `src/draft.rs`: vault limits applied per item; every parser ends here.
- `src/vault.rs`: the vault's limits as public constants, for `crates/passwords` to share.
- `src/zip_archive.rs`: the only zip reading; bounds and entry-name rules.
- Each parser's `//!` doc lists the source format it reads.

## Scope

- Owns: format detection, parsing, mapping to vault kinds and fields, vault
  limits (so preview counts are honest), zip-bomb and traversal refusal.
- Not here: writing items, ids, duplicate detection → backend import endpoint
  in `crates/passwords`; wasm bindings → the web import adapter.

## Boundaries

- Depends on: nothing Macro-specific. Pure: no I/O, async, logging or tracing.
- Used by: the browser import adapter (opts into `reveal-secrets`).

## Checks

- `cargo test -p password_import` (golden snapshots via `insta`; the explicit
  rules are in `src/draft/test.rs` and `tests/import/security.rs`).
- `cargo check -p password_import --target wasm32-unknown-unknown`.
- Fuzz: from `fuzz/`, `cargo +nightly fuzz run <target> corpus/<target> ../tests/fixtures`;
  targets: `detect`, `one_password_pux`, `one_password_csv`, `bitwarden_json`, `bitwarden_csv`.

## Gotchas

- Stays wasm-safe: excluded from workspace-hack (`.config/hakari.toml`); zip is
  `zip-inflate` (deflate only). Adding a native-only dependency breaks the browser build.
- `Debug` on every public type prints only kinds, counts and source keys; names,
  URLs, labels and folders are content too. `tests/import/redaction.rs` enforces it.
- `Serialize` exists only under the `reveal-secrets` feature and reveals
  secrets; only the browser adapter enables it.
- Over-limit values skip the item (`TooLarge`); never truncate. The limits are
  `vault::*`; the vault's own write checks in `crates/passwords` must match them.
- Hostile input stays bounded by counts, not just bytes: JSON lists are
  counted before they're kept (`bounded.rs`), per-item lists stop at 256
  entries, CSV records at 256 cells, URLs per item at 51, folders at 32 levels. Keep new lists behind
  `Bounded` or `Count`.
- Not zeroized: intermediate parser buffers (CSV records, URL parsing) and
  serde_json's scratch buffer, which holds every JSON string with an escape
  (multi-line SSH keys, most notes) in plain text until it is reused or freed.
  Only values held in `Secret` are zeroized.
- 1Password 7 CSV is refused with `UnsupportedVersion`, not read as 1Password 8.
- Source keys: `<account>:<vault>:<item>` uuids for 1Password (item uuids
  repeat across vaults), the Bitwarden id, `row:<n>` for CSV (1-based data
  row), else `item:<n>`. They must stay unique within one export.
- `ParsedExport::folders` holds only folders used by imported items, ancestors
  included; empty source folders are not carried over.

## Related

- Rules: `.agents/rules/rust/code.md` · Vault writes: `crates/passwords/src/domain/models.rs`
