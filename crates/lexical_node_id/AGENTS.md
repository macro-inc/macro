# lexical_node_id

## What it is

Wasm-safe validated identifiers shared by document consumers. Values are compared
verbatim; SQLx and OpenAPI support are optional.

## Scope

- Owns identifier validation and string conversion, never ID generation.
- No workspace-hack, randomness, or UUID dependency.

## Checks

- `cargo test -p lexical_node_id`
- `cargo test -p lexical_node_id --all-features`
- `cargo check -p lexical_node_id --target wasm32-unknown-unknown`
- `cargo clippy -p lexical_node_id --all-targets --all-features -- -D warnings`
- `cargo tree -p lexical_node_id --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- Accept every non-empty string verbatim, including whitespace and foreign ids.
- `from_stored("")` means absent; never rewrite the stored NodeState string.
- Nanoid shape is diagnostic only, never an acceptance criterion.
