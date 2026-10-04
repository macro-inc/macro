//! Error type shared by every engine module.

/// Everything that can go wrong while reading, rendering, editing, or saving.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The ZIP container is malformed.
    #[error("invalid zip archive: {0}")]
    Zip(&'static str),
    /// An XML part is not well-formed.
    #[error("invalid xml in {part}: {message} (byte {offset})")]
    Xml {
        /// The part being parsed.
        part: String,
        /// What was wrong.
        message: String,
        /// Byte offset of the problem.
        offset: usize,
    },
    /// A required part or relationship is missing.
    #[error("missing package part: {0}")]
    MissingPart(String),
    /// The package uses a feature the engine cannot process.
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// A size or count limit protecting the engine was exceeded.
    #[error("limit exceeded: {0}")]
    LimitExceeded(String),
    /// An edit operation was rejected.
    #[error("invalid edit: {0}")]
    InvalidEdit(String),
    /// A referenced slide or shape does not exist.
    #[error("not found: {0}")]
    NotFound(String),
    /// An embedded image could not be decoded.
    #[error("image decode failed: {0}")]
    Image(String),
}

/// Convenience alias for engine results.
pub type Result<T> = std::result::Result<T, Error>;
