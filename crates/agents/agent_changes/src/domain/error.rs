//! Errors of the changes domain.

use agent_session::domain::error::AgentSessionError;

/// The domain's result type.
pub type Result<T, E = ChangesError> = std::result::Result<T, E>;

/// Why a changes operation could not be served.
#[derive(Debug, thiserror::Error)]
pub enum ChangesError {
    /// The caller holds no grant that covers this operation.
    #[error("the caller may not act on this session's changes")]
    Forbidden,
    /// Nothing has been captured for the session, so there is no patch.
    #[error("no changes have been captured for this session yet")]
    NoChangeset,
    /// The summary row names a patch the blob store no longer has.
    #[error("the stored patch for this changeset is missing")]
    PatchMissing,
    /// The session itself could not be read.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// The summary store or the blob store failed.
    #[error("changes storage failed: {0}")]
    Storage(rootcause::Report),
}

/// Why an extractor could not hand back a changeset.
#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    /// The linked pull request is missing or unavailable. Shown to the user.
    #[error("{0}")]
    NotReady(String),
    /// The provider or the transport failed.
    #[error("{0}")]
    Failed(rootcause::Report),
}
