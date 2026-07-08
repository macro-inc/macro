//! IndexedDB [`Storage`](cache_core::store::Storage) backend for the browser
//! host (wasm module in a SharedWorker / dedicated worker).
//!
//! One IndexedDB database per cache namespace — the database *name* embeds
//! scope + schema hash + format version
//! ([`cache_core::codec::cache_namespace`]), so a schema/format change simply
//! opens a fresh database. Records live in a single `records` object store
//! as postcard bytes (`Uint8Array`) under their entity-key string.
//!
//! wasm32-only; on other targets this crate is an empty shell so workspace
//! `cargo test` stays green.

#[cfg(target_arch = "wasm32")]
mod idb_storage;

#[cfg(target_arch = "wasm32")]
pub use idb_storage::{IdbStorage, IdbStorageError};
