//! The crate's error type: a workflow could not be rendered as YAML.

use std::fmt;

#[derive(Debug)]
pub enum Error {
    /// A value YAML workflows have no form for, such as raw bytes.
    Unsupported(&'static str),
    /// A `Serialize` impl reported an error.
    Custom(String),
    /// An expression that doesn't parse, or reads something GitHub doesn't
    /// offer at `path`.
    Expression { path: String, message: String },
    /// A reference to a job, step or output that doesn't exist at `path`.
    Reference { path: String, message: String },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported(what) => write!(f, "cannot render {what} as workflow YAML"),
            Self::Custom(message) => f.write_str(message),
            Self::Expression { path, message } => write!(f, "expression at `{path}`: {message}"),
            Self::Reference { path, message } => write!(f, "reference at `{path}`: {message}"),
        }
    }
}

impl std::error::Error for Error {}

impl serde::ser::Error for Error {
    fn custom<T: fmt::Display>(message: T) -> Self {
        Self::Custom(message.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
