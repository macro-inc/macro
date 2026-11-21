# cache-schema

## What it is

Part of the client GraphQL cache: the schema metadata (`Schema`) that every
engine reads, derived from the GraphQL SDL. `cache-core` re-exports it as
`cache_core::meta`; use that path from engine code.

## Start here

- `src/lib.rs`: `Schema`, its canonical artifact and hash, merging, and the
  cache's schema compatibility epoch.
- `src/sdl.rs`: `Schema::from_sdl`, validation with `apollo-compiler`.

## Scope

- Owns: SDL parsing into lookup tables, the artifact's identity hash, the
  compatibility epoch, the embedded `static_assets/schema.graphql`.
- Not here: anything that reads records → `crates/client/cache-core`.

## Boundaries

- Depends on: `apollo-compiler`, `serde`, `serde_json`, `sha2` only.
- Used by: `cache-core` (re-export), `cache-wasm`'s `build.rs` (encodes the
  bundled tables at build time).

## Checks

- `cargo test -p cache-schema`
- A change to the artifact's shape: `cargo test -p cache-wasm` on wasm
  (`apps/web`'s cache wasm tests) compares the build-time tables with a parse.

## Gotchas

- Keep this crate free of `cache-core` and `database_sql`: it is a build
  dependency of `cache-wasm`, and `database_sql` is a cdylib whose unhashed
  output files collide when a native build compiles it twice.
- A change to the artifact's shape or the epoch changes every cache's schema
  hash; incompatible changes bump `CACHE_SCHEMA_COMPATIBILITY_EPOCH`.
