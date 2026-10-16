//! Errors.

/// What went wrong opening, editing, or saving a document.
#[derive(Debug, thiserror::Error)]
pub enum PsdError {
    /// The bytes are not a Photoshop file.
    #[error("not a Photoshop document")]
    NotPsd,
    /// The file uses something the engine cannot read or write.
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// The file is damaged.
    #[error("damaged file: {0}")]
    Corrupt(String),
    /// An edit cannot be applied.
    #[error("{0}")]
    Invalid(String),
    /// The document's pixels would need more memory than allowed.
    #[error("the document is too large to open here ({0} MB of pixels)")]
    TooLarge(u64),
}

impl PsdError {
    /// A damaged-file error.
    pub fn corrupt(what: impl Into<String>) -> PsdError {
        PsdError::Corrupt(what.into())
    }

    /// An invalid-edit error.
    pub fn invalid(what: impl Into<String>) -> PsdError {
        PsdError::Invalid(what.into())
    }
}

/// Results of engine operations.
pub type Result<T> = std::result::Result<T, PsdError>;
