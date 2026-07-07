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

    /// Requested resource not found - maps to 404
    #[error("Property definition not found")]
    NotFound,

    /// Property option not found - maps to 404
    #[error("Property option not found")]
    OptionNotFound,

    /// An option with the requested value already exists - maps to 409
    #[error("An option with that value already exists")]
    DuplicateOptionValue,

    /// System properties cannot be modified - maps to 403
    #[error("Cannot modify system properties")]
    SystemPropertyNotModifiable,

    /// Repository/database errors - maps to 500
    #[error(transparent)]
    Repo(#[from] anyhow::Error),

    /// Permission service is not configured
    #[error("permission service is not configured")]
    PermissionServiceNotConfigured,
}
