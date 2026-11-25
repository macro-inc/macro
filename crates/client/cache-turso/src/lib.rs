//! Production Turso storage adapter for the normalized GraphQL cache.
//!
//! The adapter implements every [`cache_core::store::Storage`] operation with
//! the frozen compound-key schema, checked postcard payloads, strict-head
//! mutation leasing, and immediate write transactions. Incompatible or
//! uncertain disposable state is classified for physical reset; it is never
//! migrated, copied, logged, or redirected to a fallback backend. Only its
//! mutation queue is carried to the next database, which no refetch replaces.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod driver;
mod error;
mod key;
pub mod query_telemetry;
mod storage;

pub use driver::{WalCheckpoint, WalPosition};
pub use error::{PhysicalResetReason, TursoStorageError};
pub use storage::{
    QueueImport, QueueLoss, QueueRead, QueuedMutationCount, STORAGE_SCHEMA_VERSION, SalvageFile,
    SalvagedQueue, TursoStorage, TursoStorageCloseOutcome, TursoStorageOpenOutcome,
};

#[cfg(target_arch = "wasm32")]
pub use storage::{
    HealthyTursoStorageClosed, ResetRequiredTursoStorageClosed, TursoStorageCloseFailure,
    TursoStorageOpenFailure, TursoStorageResetFailure, count_queued_mutations, read_queue,
};
#[cfg(not(target_arch = "wasm32"))]
pub use storage::{TursoFileDatabase, TursoMemoryDatabase};
