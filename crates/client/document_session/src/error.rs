/// A rejected session input or a failed surface operation.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// The winning seed has not initialized this surface.
    #[error("document surface is not ready")]
    NotReady,
    /// Current effective access prohibits this edit.
    #[error("document is read-only")]
    ReadOnly,
    /// An input belongs to another surface or to the internal import path.
    #[error("input does not belong to this surface")]
    WrongSurface,
    /// Host configuration violates a session invariant.
    #[error("invalid session configuration: {0}")]
    Configuration(&'static str),
    /// Host-provided peer ids were invalid or exhausted.
    #[error(transparent)]
    Sync(#[from] doc_sync_core::SyncError),
    /// Native Loro rejected the operation.
    #[error(transparent)]
    Loro(#[from] loro::LoroError),
    /// Editor projection failed.
    #[error(transparent)]
    Projection(#[from] lexical_loro::ProjectionError),
    /// Model operation failed.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    /// Editor configuration failed validation.
    #[error(transparent)]
    Build(#[from] lexical_model::BuildError),
    /// A generic batch failed validation before applying any live operation.
    #[error("invalid document operation {index}: {error}")]
    InvalidOp {
        /// Zero-based position in the batch.
        index: usize,
        /// Validation failure.
        error: DocError,
    },
    /// A generic path or value is invalid.
    #[error(transparent)]
    Document(#[from] DocError),
}

/// A generic container/path/value contract violation.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DocError {
    /// The path does not resolve to an attached container.
    #[error("container path does not exist")]
    MissingPath,
    /// The operation targets a different container kind.
    #[error("operation requires another container kind")]
    WrongKind,
    /// A sequence range exceeds its current bounds.
    #[error("sequence range is out of bounds")]
    OutOfBounds,
    /// UTF-16 text indices must be Unicode scalar boundaries.
    #[error("text index splits a surrogate pair")]
    SurrogateBoundary,
    /// JSON-shaped numbers must be finite.
    #[error("document numbers must be finite")]
    NonFinite,
    /// A creation marker cannot occur within a plain scalar composite.
    #[error("nested container creation requires a separate document operation")]
    NestedContainer,
    /// The runtime produced an unsupported container kind.
    #[error("container kind is not supported by the generic surface")]
    UnsupportedContainer,
}
