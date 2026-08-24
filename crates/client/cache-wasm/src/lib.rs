//! wasm-bindgen shell around the generic cache engine + Turso OPFS storage.
//!
//! Soup-specific GraphQL materialization and projection policy live in
//! `soup-filter-cache-adapter`. This shell links that adapter at the browser
//! composition edge and passes only generic predicate/projection IR into the
//! cache engine.
//!
//! Exposes a `CacheEngine` class to the JS worker glue
//! (`apps/web/src/lib/graphql-cache/`). All methods return Promises; the
//! engine is guarded by an async mutex so overlapping calls from the JS side
//! serialize safely instead of tripping reentrancy.
//!
//! Operation ids cross the boundary as strings (`"{clientId}:{urqlKey}"`)
//! so multiple tabs/webviews can register operations against one shared
//! engine without collisions; they're interned to the engine's `u64` ids
//! internally.

#[cfg(target_arch = "wasm32")]
mod shell;

#[cfg(target_arch = "wasm32")]
pub use shell::*;
