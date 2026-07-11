//! wasm-bindgen shell around the cache engine + IndexedDB storage.
//!
//! Exposes a `CacheEngine` class to the JS worker glue
//! (`apps/web/packages/graphql-cache/`). All methods return Promises; the
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
