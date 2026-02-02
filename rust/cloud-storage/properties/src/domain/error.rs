//! Domain error types for properties.

use thiserror::Error;

/// Domain error type for property operations.
#[derive(Debug, Error)]
pub enum PropertiesErr {
    /// Validation errors (includes property not found) - maps to 400
    #[error("{0}")]
    Validation(String),

    /// Permission denied - maps to 403
    #[error("Access denied")]
    PermissionDenied,

    /// Repository/database errors - maps to 500
    #[error(transparent)]
    Repo(#[from] anyhow::Error),

    /// Permission service is not configured
    #[error("permission service is not configured")]
    PermissionServiceNotConfigured,
}
