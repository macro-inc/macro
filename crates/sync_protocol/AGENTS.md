# sync_protocol

## What it is

Shared, worker-free wire types for document collaboration and sync routing.

## Start here

- `bebop/schema.bop`: wire schema served by sync-service.
- `bebop/generate.mjs`: pinned TypeScript/Rust code generation.
- `src/lib.rs`: public types, heartbeat constants and message display names.
- `src/framing.rs`: frame codec and per-connection reassembly.
- `src/time.rs`: signed wall-clock millisecond types.
- `src/test.rs`: cross-language byte fixtures and inventory coverage guard.

## Boundaries

- Depends on the Bebop runtime; no Worker or service dependency.
- Used by sync-service, sync_router and document_storage_service.

## Recipes

- Install sync-service's JavaScript dependencies, then run
  `node crates/sync_protocol/bebop/generate.mjs` from the repository root.
- The generator maps Bebop's generated owned guard to this crate's `owned`
  feature. Keep generated TypeScript bytes identical to the wire fixtures.

## Checks

- `cargo test -p sync_protocol --features owned`
- `cargo check -p sync_protocol --target wasm32-unknown-unknown`
- Sync-service's transcript comparison covers the `/schema` response bytes.

## Gotchas

- Keep edition 2021: the pinned generated Rust uses earlier match ergonomics.
- Keep this crate excluded from hakari; workspace-hack is not wasm-safe.
