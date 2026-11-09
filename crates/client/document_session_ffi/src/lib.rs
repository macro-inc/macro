//! Typed native-view document session adapter; the host executes all I/O.
#![deny(missing_docs)]
use doc_sync_core::*;
use document_session::*;
use lexical_model::*;
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
mod model_types;
mod query;
mod sync_types;
pub use query::*;
mod convert;
mod output;
pub use output::*;
mod session;
pub use session::*;
mod input;
pub use input::*;
mod values;
pub use values::*;
uniffi::setup_scaffolding!();

/// A rejected native boundary operation.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FfiSessionError {
    /// Invalid host data, model operation or session state.
    #[error("{reason}")]
    Invalid {
        /// Diagnostic without credentials or document contents.
        reason: String,
    },
    /// A previous panic poisoned the serialization lock.
    #[error("native session lock is poisoned")]
    Poisoned,
    /// The optional native storage executor is not configured in this build.
    #[error("doc_store_turso is not available; execute storage effects in the host")]
    StoreNotConfigured,
}
fn invalid(error: impl std::fmt::Display) -> FfiSessionError {
    FfiSessionError::Invalid {
        reason: error.to_string(),
    }
}
fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, FfiSessionError> {
    mutex.lock().map_err(|_| FfiSessionError::Poisoned)
}

/// Development-only fixture interpreter entry point for native ABI conformance.
#[cfg(feature = "conformance")]
pub mod conformance;
#[cfg(test)]
mod test;
