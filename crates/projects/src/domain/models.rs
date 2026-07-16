//! Domain-owned project models.

/// Errors produced by project operations.
#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    /// The requested project was not found.
    #[error("project not found: {0}")]
    NotFound(String),
    /// The caller is not authorized to perform the operation.
    #[error("unauthorized")]
    Unauthorized,
    /// The caller is not authorized, with a client-facing explanation.
    #[error("{0}")]
    UnauthorizedWithMessage(String),
    /// The request is invalid.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// The provided project name exceeds the maximum length.
    #[error("name too long")]
    NameTooLong {
        /// Maximum allowed name length, in grapheme clusters.
        max: usize,
    },
    /// A soft-deleted project cannot be modified.
    #[error("cannot modify deleted project")]
    CannotModifyDeleted,
    /// The requested parent would recursively nest the project.
    #[error("project is recursively nested")]
    RecursiveNesting,
    /// An internal operation failed.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}
