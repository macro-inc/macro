//! Error types for system properties.

use thiserror::Error;

/// Errors that can occur when working with system properties.
#[derive(Debug, Error)]
pub enum SystemPropertyError {
    /// Atomic completion admission rejected a blocked task.
    #[error("Task is blocked")]
    TaskCompletionBlocked,
    /// Database error
    #[error("Database error: {0}")]
    Database(rootcause::Report),

    /// Serialization error
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Validation error
    #[error("Validation error: {0}")]
    Validation(String),
}
