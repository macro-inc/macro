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

#[cfg(feature = "inbound")]
impl axum::response::IntoResponse for ChatErr {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;

        let (status, msg) = match &self {
            ChatErr::NotFound => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::BadRequest(_) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Access(
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
            ) => (StatusCode::FORBIDDEN, "Forbidden"),
            ChatErr::Access(AccessError::NotFound(_)) => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::Access(AccessError::BadRequest(_)) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Unknown(_) | ChatErr::Access(_) => {
                tracing::error!(error=?self, "chat handler error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };

        (status, msg.to_string()).into_response()
    }
}
