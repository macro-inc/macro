//! Persona domain errors.

use thiserror::Error;

/// Result alias for persona operations.
pub type Result<T, E = PersonaError> = std::result::Result<T, E>;

/// Errors produced by persona use cases.
#[derive(Debug, Error)]
pub enum PersonaError {
    /// The request is malformed: bad handle, over-long field, etc.
    #[error("{0}")]
    BadRequest(String),
    /// The handle is already used by another of the caller's personas, or is
    /// reserved by a first-party agent.
    #[error("handle is already in use")]
    HandleTaken,
    /// No persona with this id is visible to the caller.
    ///
    /// Deliberately also covers "exists but belongs to someone else":
    /// personas are private, so their existence is not disclosed.
    #[error("persona not found")]
    NotFound,
    /// Something failed underneath.
    #[error("{0}")]
    Repo(rootcause::Report),
}

impl From<rootcause::Report> for PersonaError {
    fn from(report: rootcause::Report) -> Self {
        Self::Repo(report)
    }
}
