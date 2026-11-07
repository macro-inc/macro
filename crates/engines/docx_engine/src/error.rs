//! Error type shared by every engine module.

/// Everything that can go wrong while reading, laying out, editing, or saving.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The package container (ZIP, OPC) failed; see the source error.
    #[error(transparent)]
    Package(#[from] pptx_engine::Error),
    /// An XML part is not well-formed.
    #[error("invalid xml in {part}: {message}")]
    Xml {
        /// The part being parsed.
        part: String,
        /// What was wrong.
        message: String,
    },
    /// A required part is missing.
    #[error("missing part: {0}")]
    MissingPart(String),
    /// The package is not a WordprocessingML document.
    #[error("not a Word document: {0}")]
    NotWord(String),
    /// An edit operation was rejected.
    #[error("invalid edit: {0}")]
    InvalidEdit(String),
    /// A referenced block or position does not exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// Shared collaborative state could not be read.
    #[error("invalid collaborative state: {0}")]
    Collab(String),
}

/// Convenience alias for engine results.
pub type Result<T> = std::result::Result<T, Error>;
