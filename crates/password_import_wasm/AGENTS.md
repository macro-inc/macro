# password_import_wasm

## What it is

The browser adapter for `password_import`: wasm-bindgen `detect` and `parse`,
returning the parsed export in the vault's import batch shapes. Runs in the
web import dialog's worker, so the export file never leaves the device.

## Start here

- `src/wire.rs`: the serialized shapes (`PasswordImportItem`, folder keys).
- `src/bindings.rs`: the wasm entry points (wasm32 only).

## Scope

- Owns: mapping `ParsedExport` to the batch wire shape, folder keys and parent links.
- Not here: parsing → `password_import`; batching, duplicates, requests →
  `apps/web/src/features/passwords` (`core/import.ts`, `primitives/import.ts`).

## Boundaries

- Depends on: `password_import` with `serde` (the only crate that enables it).
- Used by: `apps/web/src/lib/core/password-import/` (`just build-password-import-wasm`).

## Checks

- `cargo test -p password_import_wasm`.
- `just --justfile apps/web/justfile build-password-import-wasm`.

## Gotchas

- The serialized values are revealed secrets; nothing here logs or formats them.
- Folder keys are `folder:<index>` in parse order, stable for the same file, so
  a resumed import sends the same keys.
- The wire shapes mirror `crates/passwords` `ImportItem`/`ImportFolder`
  (`deny_unknown_fields`); change both together. Field `concealed` is not sent.
- Excluded from workspace-hack (`.config/hakari.toml`), like `password_import`.
