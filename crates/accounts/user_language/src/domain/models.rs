//! Domain models for user languages.

/// Errors returned by the user language service.
#[derive(Debug, thiserror::Error)]
pub enum UserLanguageError {
    /// The user does not exist.
    #[error("user not found")]
    UserNotFound,
    /// Any other internal error.
    #[error("internal user language error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for UserLanguageError {
    fn from(report: rootcause::Report) -> Self {
        UserLanguageError::Internal(report)
    }
}
