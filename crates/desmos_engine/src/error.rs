//! Errors from parsing, evaluating, or plotting.

use thiserror::Error;

/// A recoverable engine failure.
#[derive(Debug, Error, PartialEq)]
pub enum DesmosError {
    /// The expression could not be parsed.
    #[error("syntax error: {0}")]
    Syntax(String),
    /// Evaluation hit an undefined name or invalid call.
    #[error("{0}")]
    Eval(String),
    /// The stored document JSON is not a supported graph.
    #[error("invalid document: {0}")]
    Document(String),
}

/// Engine result.
pub type Result<T> = std::result::Result<T, DesmosError>;
