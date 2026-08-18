//! Production Turso storage adapter for the normalized GraphQL cache.
//!
//! The adapter implements every [`cache_core::store::Storage`] operation with
//! the frozen compound-key schema, checked postcard payloads, strict-head
//! mutation leasing, and immediate write transactions. Incompatible or
//! uncertain disposable state is classified for physical reset; it is never
//! migrated, copied, logged, or redirected to a fallback backend.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod driver;
mod error;
mod key;
mod storage;

pub use error::{PhysicalResetReason, TursoStorageError};
pub use storage::{
    BROWSER_STORAGE_SCHEMA_VERSION, TursoStorage, TursoStorageCloseOutcome, TursoStorageOpenOutcome,
};

#[cfg(not(target_arch = "wasm32"))]
pub use storage::TursoMemoryDatabase;
#[cfg(target_arch = "wasm32")]
pub use storage::{
    HealthyTursoStorageClosed, ResetRequiredTursoStorageClosed, TursoStorageCloseFailure,
    TursoStorageOpenFailure, TursoStorageResetFailure,
};
