//! IndexedDB [`Storage`](cache_core::store::Storage) backend for the browser
//! host (wasm module in a SharedWorker / dedicated worker).
//!
//! One stable IndexedDB database per cache scope. Disposable normalized
//! records are versioned through metadata, while queued mutations and their
//! optimistic layers remain discoverable across record-schema changes.
//! Postcard payloads are stored as `Uint8Array` values.
//!
//! wasm32-only; on other targets this crate is an empty shell so workspace
//! `cargo test` stays green.

#[cfg(target_arch = "wasm32")]
mod idb_storage;

#[cfg(target_arch = "wasm32")]
pub use idb_storage::{IdbStorage, IdbStorageError};
