//! Error types for system properties.

use thiserror::Error;

/// Errors that can occur when working with system properties.
#[derive(Debug, Error)]
pub enum SystemPropertyError {
    /// Database error
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    /// Serialization error
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Validation error
    #[error("Validation error: {0}")]
    Validation(String),
}
