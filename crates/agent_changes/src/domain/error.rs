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
    /// The pull request drafter failed.
    #[error("could not draft a pull request: {0}")]
    Draft(rootcause::Report),
}

/// Why an extractor could not hand back a changeset.
#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    /// No extractor serves this session's harness.
    #[error("changes are not available for the {harness} harness")]
    Unsupported {
        /// The harness slug that has no extractor.
        harness: String,
    },
    /// The harness has nothing to compare yet: a branch not pushed, a
    /// daemon not connected. The message is shown to the user as is.
    #[error("{0}")]
    NotReady(String),
    /// The provider or the transport failed.
    #[error("{0}")]
    Failed(rootcause::Report),
}

/// Why a repository comparison could not be answered.
#[derive(Debug, thiserror::Error)]
pub enum CompareError {
    /// One side of the range does not exist on the provider - typically a
    /// branch that has not been pushed yet.
    #[error("the compared ref does not exist on the repository")]
    NotFound,
    /// The provider refuses to render a diff this large.
    #[error("the diff is too large for the repository provider to compare")]
    TooLarge,
    /// The caller may not reach the repository through the provider.
    #[error("the repository is not reachable through the configured GitHub App")]
    Unavailable,
    /// Anything else.
    #[error("{0}")]
    Other(rootcause::Report),
}
