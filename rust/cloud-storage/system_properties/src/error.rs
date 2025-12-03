//! Error types for system properties.

use thiserror::Error;

/// Errors that can occur when working with system properties.
#[derive(Debug, Error)]
pub enum SystemPropertyError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Validation error: {0}")]
    Validation(String),
}
