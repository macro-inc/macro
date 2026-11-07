# id_newtype

## What it is

Shared infrastructure: `uuid_id!`, the one way to declare a UUID-backed id
newtype (CS-10). Each id is a `nutype` over `Uuid`, transparent on the wire.

## Start here

- `src/lib.rs`: the macro and what every id gets.

## Boundaries

- Depends on: `nutype`, `uuid`, `macro_uuid`. Must stay wasm-safe
  (`models_databases` runs in the browser); it is a hakari traversal exclude.
- Used by: `models_databases`, `models_forms`.

## Recipes

- Add an id: `id_newtype::uuid_id!(/// docs \n pub FooId; derive_unchecked(...))`.
  Pass schema derives after the `;`, with their attributes
  (`#[schema(value_type = Uuid)]`, `#[specta(transparent)]`) above the name.

## Checks

- `cargo test -p id_newtype`

## Gotchas

- The caller crate must depend on `serde`; nutype's generated impls name
  `::serde`. Add it to `[package.metadata.cargo-shear] ignored` if the crate
  uses it nowhere else.
- `new(uuid)` is nutype's constructor; a fresh id is `generate()`.
- Ids with validation (non-nil, string formats) use `#[nutype(validate(...))]`
  directly, as `ai_usage` and `slack_integration` do; this macro is for plain
  UUID ids.

## Related

- Rules: `.agents/rules/rust/code.md` (CS-10 newtype ids, CS-63 `generate()`)
