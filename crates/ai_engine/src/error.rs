//! Errors.

/// What went wrong opening, editing, or saving a document.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    /// The bytes are not an Illustrator (or PDF) file.
    #[error("not an Illustrator document")]
    NotAi,
    /// The file uses something the engine cannot read or write.
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// The file is damaged.
    #[error("damaged file: {0}")]
    Corrupt(String),
    /// The file is encrypted.
    #[error("the document is encrypted")]
    Encrypted,
    /// An edit cannot be applied.
    #[error("{0}")]
    Invalid(String),
}

impl AiError {
    /// A damaged-file error.
    pub fn corrupt(what: impl Into<String>) -> AiError {
        AiError::Corrupt(what.into())
    }

    /// An invalid-edit error.
    pub fn invalid(what: impl Into<String>) -> AiError {
        AiError::Invalid(what.into())
    }
}

/// Results of engine operations.
pub type Result<T> = std::result::Result<T, AiError>;
