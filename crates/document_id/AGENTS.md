# document_id

## What it is

Wasm-safe validated identifiers shared by document consumers. Values are compared
verbatim; SQLx and OpenAPI support are optional.

## Scope

- Owns identifier validation and string conversion, never ID generation.
- No workspace-hack or random UUID features; `uuid_value` is the parsing-only dependency.

## Checks

- `cargo test -p document_id`
- `cargo test -p document_id --all-features`
- `cargo check -p document_id --target wasm32-unknown-unknown`
- `cargo clippy -p document_id --all-targets --all-features -- -D warnings`
- `cargo tree -p document_id --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Reject empty, surrounding whitespace, and control characters; preserve internal spaces
  and uppercase UUID text. `from_uuid` alone emits lowercase hyphenated text.
