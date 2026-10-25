# cache-wasm

## What it is

Part of the web client's shared infrastructure: the browser-only
wasm-bindgen shell exposing `cache-core` + `cache-turso` + `turso-opfs` as a
`CacheEngine` JS class to the web worker glue in
`apps/web/src/lib/graphql-cache/`.

## Start here

- `src/shell.rs`: the `CacheEngine` wasm-bindgen class — translates JS calls
  into `cache-core` engine calls behind an async mutex.
- `src/query_telemetry.rs`: slow-query callback exposed to JS.
- `apps/web/src/lib/graphql-cache/`: the JS/TS worker that owns this engine.

## Scope

- Owns: the wasm boundary — operation-id interning (`"{clientId}:{urqlKey}"` →
  internal `u64`), Promise-based method signatures, and composing `soup-filter-cache-adapter`
  at the browser composition edge.
- Not here: cache engine logic → `crates/client/cache-core`; Soup-specific
  projection policy → `soup_filter_cache_adapter`, `soup_filter_projection`
  (composed here, not reimplemented); OPFS storage → `crates/client/cache-turso`,
  `crates/client/turso-opfs`.

## Boundaries

- Depends on: `cache-core` (all targets), `cache-turso`/`turso-opfs`/
  `soup-filter-cache-adapter` (wasm32 target only).
- Used by: `apps/web` only, through the generated wasm-bindgen glue — no other
  Rust crate depends on this one.

## Recipes

- Expose a new engine capability to JS: implement it in `cache-core` first →
  add the wasm-bindgen method in `src/shell.rs` → update the TS caller in
  `apps/web/src/lib/graphql-cache/`.

## Checks

- Off-wasm: `cargo test -p cache-wasm` compiles the empty non-wasm shell only.
- Real coverage is wasm32: `cargo test --target wasm32-unknown-unknown -p cache-wasm`
  (see `crates/client/turso-opfs/README.md` for the `wasm-bindgen-test` pattern
  this crate also follows).

## Gotchas

- Email send persistence and cancellation belong to the frontend email journal, not the normalized cache or its mutation queue.

- The engine is guarded by an async mutex so overlapping JS calls serialize
  instead of causing reentrancy — don't bypass it with a second entry point.
- Compiles to an empty shell off-wasm specifically so plain `cargo test` across
  the workspace stays green; don't make the non-wasm cfg path do real work.

## Related

- Rules: `.agents/rules/rust/architecture.md`
