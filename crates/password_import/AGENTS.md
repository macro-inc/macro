# password_import

## What it is

Passwords import: parses 1Password and Bitwarden exports into items the team
vault (`crates/passwords`) accepts. Runs in the browser as wasm, so the raw
file never leaves the device.

## Start here

- `src/lib.rs`: `detect`, `parse`, the public types.
- `src/draft.rs`: vault limits applied per item; every parser ends here.
- `src/zip_archive.rs`: the only zip reading; bounds and entry-name rules.

## Scope

- Owns: format detection, parsing, mapping to vault kinds and fields, vault
  limits (so preview counts are honest), zip-bomb and traversal refusal.
- Not here: writing items, ids, duplicate detection → backend import endpoint
  in `crates/passwords`; wasm bindings → the web import adapter.

## Boundaries

- Depends on: nothing Macro-specific. Pure: no I/O, async, logging or tracing.
- Used by: the browser import adapter (opts into the `serde` feature).

## Checks

- `cargo test -p password_import` (golden snapshots via `insta`; review
  `tests/import/snapshots/` diffs line by line, they are the mapping spec).
- `cargo check -p password_import --target wasm32-unknown-unknown`.
- Fuzz: from `fuzz/`, `cargo +nightly fuzz run <target> corpus/<target> ../tests/fixtures`;
  targets: `detect`, `one_password_pux`, `one_password_csv`, `bitwarden_json`, `bitwarden_csv`.

## Gotchas

- Stays wasm-safe: excluded from workspace-hack (`.config/hakari.toml`); zip is
  `zip-inflate` (deflate only). Adding a native-only dependency breaks the browser build.
- `Debug` on every public type prints only kinds, counts and source keys; names,
  URLs, labels and folders are content too. `tests/import/redaction.rs` enforces it.
- `Serialize` exists only under the `serde` feature and reveals secrets; only
  the browser adapter enables it.
- Over-limit values skip the item (`TooLarge`); never truncate. Limits mirror
  `passwords::WriteItem::validate`, `LoginUrl` and the TOTP key regex; change both together.
- Intermediate parser buffers (CSV records, URL parsing) are not zeroized; only
  values held in `Secret` are.
- `ParsedExport::folders` holds only folders used by imported items, ancestors
  included; empty source folders are not carried over.

## Format assumptions

From public format docs and open-source importers (format knowledge only):

- `.1pux`: zip with `export.data` JSON `accounts[].vaults[].items[]`; item
  `uuid`, `categoryUuid` (3-digit codes), `state` (`active`/`archived`),
  `trashed`, `favIndex`, `overview.{title,url,urls[].url,tags}`,
  `details.{loginFields[] (designation username/password), notesPlain, password,
  sections[].fields[] {title,id,value:{<type>: v}}, passwordHistory, passkey,
  documentAttributes}`. Value types: string, concealed, totp, email (string or
  `{email_address}`), phone, url, date (unix s), monthYear (`YYYYMM`),
  creditCardNumber/Type, menu, gender, address object, sshKey object, file,
  reference. Other `files/` entries are never read.
- 1Password CSV: 1Password 8 header `Title,Url,Username,Password,OTPAuth,
  Favorite,Archived,Tags,Notes` (case-insensitive); extra columns become fields;
  `Tags` is kept whole as written. Older 1Password CSV layouts are unknown formats.
- Bitwarden JSON: `encrypted`, `folders[{id,name}]` (`a/b` nests),
  `items[]` with `type` 1–5, `login.{uris,username,password,totp,fido2Credentials}`,
  `card`, `identity`, `sshKey`, `fields[{name,value,type 0–3}]`,
  `organizationId`, `collectionIds`, `deletedDate`, `archivedDate`,
  `passwordHistory`, `attachments`. `encrypted: true` → `EncryptedBitwarden`.
- Bitwarden CSV: personal header `folder,favorite,type,name,notes,fields,
  reprompt,login_uri,login_username,login_password,login_totp`; `type` login or
  note; `fields` is `name: value` lines (all concealed, the CSV loses hidden-ness);
  `login_uri` comma-separated. A `collections` column marks an organization
  export: every row is skipped as `SharedCollection`.
- CSV source keys are `row:<n>`, the 1-based data row (header excluded).

## Related

- Rules: `.agents/rules/rust/code.md` · Vault limits: `crates/passwords/src/domain/models.rs`
