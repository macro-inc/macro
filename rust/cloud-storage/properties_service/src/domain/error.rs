//! Domain error types

use thiserror::Error;

/// Domain-level errors for property operations
#[derive(Debug, Error)]
pub enum PropertyError {
    /// Resource not found
    #[error("{0}")]
    NotFound(String),

    /// Validation error
    #[error("Validation error: {0}")]
    ValidationError(String),

    /// Permission denied
    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    /// Internal error (wraps storage errors, permission check errors, etc.)
    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

/// Result type for domain operations
pub type Result<T> = std::result::Result<T, PropertyError>;
