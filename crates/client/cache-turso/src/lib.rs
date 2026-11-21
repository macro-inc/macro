//! Production Turso storage adapter for the normalized GraphQL cache.
//!
//! The adapter implements every [`cache_core::store::Storage`] operation with
//! the frozen compound-key schema, checked postcard payloads, strict-head
//! mutation leasing, and immediate write transactions. A database written at an
//! older storage version with registered upgrade steps is upgraded in place;
//! other incompatible or uncertain disposable state is classified for physical
//! reset, never copied, logged, or redirected to a fallback backend.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod driver;
mod error;
mod key;
pub mod query_telemetry;
mod storage;

pub use error::{PhysicalResetReason, TursoStorageError};
pub use storage::{
    QueuedMutationCount, STORAGE_SCHEMA_VERSION, TursoStorage, TursoStorageCloseOutcome,
    TursoStorageOpenOutcome, oldest_upgradable_storage_version, storage_version_upgradable,
};

#[cfg(feature = "migration-test-hooks")]
pub use storage::migration_test_hooks;

#[cfg(target_arch = "wasm32")]
pub use storage::{
    HealthyTursoStorageClosed, ResetRequiredTursoStorageClosed, TursoStorageCloseFailure,
    TursoStorageOpenFailure, TursoStorageResetFailure, count_queued_mutations,
};
#[cfg(not(target_arch = "wasm32"))]
pub use storage::{TursoFileDatabase, TursoMemoryDatabase};
