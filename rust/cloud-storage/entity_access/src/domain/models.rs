//! Domain models for entity access.

pub use model_entity::EntityType;
pub use models_permissions::share_permission::access_level::AccessLevel;

/// Errors that can occur during access checking.
#[derive(Debug, thiserror::Error)]
pub enum AccessError {
    /// User does not have access to the requested resource.
    #[error("User does not have access to the requested resource")]
    Unauthorized,

    /// User does not have access with a specific message.
    #[error("{0}")]
    UnauthorizedWithMessage(&'static str),

    /// Database error during access check.
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    /// Bad request parameters.
    #[error("Bad request: {0}")]
    BadRequest(&'static str),

    /// Internal server error.
    #[error("Internal error")]
    Internal,
}
