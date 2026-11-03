//! The crate's one error type.

use std::path::PathBuf;

/// Everything that can go wrong in this crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A configuration value is missing or malformed.
    #[error("configuration: {0}")]
    Config(String),

    /// An HTTP request could not be sent or its body could not be read.
    #[error("could not {what}: {source}")]
    Http {
        /// What the request was for, e.g. `post a message`.
        what: &'static str,
        /// The underlying transport error.
        #[source]
        source: reqwest::Error,
    },

    /// Macro answered with a non-success status.
    #[error("Macro answered {status} to {what}: {body}")]
    Status {
        /// What the request was for.
        what: &'static str,
        /// The HTTP status code.
        status: u16,
        /// The start of the response body, for diagnosis.
        body: String,
    },

    /// A file or process operation failed.
    #[error("{action} {path}: {source}")]
    Io {
        /// What was being done, e.g. `read`.
        action: &'static str,
        /// The path involved.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },

    /// JSON could not be encoded or decoded.
    #[error("invalid JSON in {what}: {source}")]
    Json {
        /// What was being encoded or decoded.
        what: String,
        /// The underlying error.
        #[source]
        source: serde_json::Error,
    },

    /// The relevance file breaks a rule (question limits, unknown keys, ...).
    #[error("relevance config: {0}")]
    Relevance(String),

    /// A schedule expression could not be parsed.
    #[error("schedule: {0}")]
    Schedule(String),

    /// Waking the agent failed before the turn could run.
    #[error("wake: {0}")]
    Wake(String),
}

impl Error {
    /// The HTTP status Macro answered with, if this is a status error.
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Status { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub(crate) fn io(
        action: &'static str,
        path: impl Into<PathBuf>,
        source: std::io::Error,
    ) -> Self {
        Self::Io {
            action,
            path: path.into(),
            source,
        }
    }

    pub(crate) fn json(what: impl Into<String>, source: serde_json::Error) -> Self {
        Self::Json {
            what: what.into(),
            source,
        }
    }
}

/// The crate's result type.
pub type Result<T, E = Error> = std::result::Result<T, E>;
