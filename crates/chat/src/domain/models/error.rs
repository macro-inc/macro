use entity_access::domain::models::AccessError;
use thiserror::Error;

/// A `Result` alias where the error type is [`ChatErr`].
pub type Result<T> = std::result::Result<T, ChatErr>;

/// Domain error type for chat operations.
#[derive(Debug, Error)]
pub enum ChatErr {
    /// The requested chat was not found.
    #[error("chat not found")]
    NotFound,
    /// An unexpected error occurred.
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
    /// Bad request
    #[error("bad request: {0}")]
    BadRequest(String),
    /// Access denied.
    #[error(transparent)]
    Access(#[from] AccessError),
}
