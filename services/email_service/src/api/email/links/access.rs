use crate::outbound::persistence_error::InboxPersistenceError;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use email::domain::mailbox::catalog::InboxAccessError;
use model::response::ErrorResponse;
use thiserror::Error;

/// Error shared by the per-inbox action handlers (delete, resync). Carries
/// `Display` so handlers can be instrumented with `err`.
#[derive(Debug, Error)]
pub enum InboxActionError {
    #[error("inbox changed or is disconnecting; retry after it settles")]
    Conflict,
    #[error("inbox not found")]
    NotFound,

    #[error("not authorized for this inbox")]
    Forbidden,

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for InboxActionError {
    fn into_response(self) -> Response {
        let status = match &self {
            InboxActionError::Conflict => StatusCode::CONFLICT,
            InboxActionError::NotFound => StatusCode::NOT_FOUND,
            InboxActionError::Forbidden => StatusCode::FORBIDDEN,
            InboxActionError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            InboxActionError::Internal(_) => "internal error".to_string(),
            other => other.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<email::domain::mailbox::lifecycle::InboxLifecycleError> for InboxActionError {
    fn from(error: email::domain::mailbox::lifecycle::InboxLifecycleError) -> Self {
        use email::domain::mailbox::lifecycle::InboxLifecycleError;
        match error {
            InboxLifecycleError::NotFound => Self::NotFound,
            InboxLifecycleError::Forbidden => Self::Forbidden,
            InboxLifecycleError::Changed | InboxLifecycleError::Disconnecting => Self::Conflict,
            InboxLifecycleError::Unavailable => Self::Internal(anyhow::Error::new(error)),
        }
    }
}

impl From<InboxAccessError<InboxPersistenceError>> for InboxActionError {
    fn from(error: InboxAccessError<InboxPersistenceError>) -> Self {
        match error {
            InboxAccessError::NotFound => Self::NotFound,
            InboxAccessError::Forbidden => Self::Forbidden,
            InboxAccessError::Query(error) => Self::Internal(error.into_inner()),
        }
    }
}
