use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::post};
use axum_extra::extract::Cached;
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::{
    EmailLinkExtractor, EmailRouterState,
    api_types::{SendMessageRequest, SendMessageResponse},
};

/// Create the send router with a `POST /` handler.
pub fn send_router<S, T>(state: EmailRouterState<T>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: EmailService,
{
    Router::new()
        .route("/", post(send_message_handler::<T>))
        .with_state(state)
}

/// Errors from the send message handler.
#[derive(Debug, Error)]
pub enum SendMessageError {
    /// Validation error (bad request).
    #[error("{0}")]
    Validation(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for SendMessageError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, SendMessageError::Internal(_)) {
            tracing::error!(error=?self, "send message error");
        }

        let status = match &self {
            SendMessageError::Validation(_) => StatusCode::BAD_REQUEST,
            SendMessageError::NotFound(_) => StatusCode::NOT_FOUND,
            SendMessageError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (status, Json(ErrorResponse { message: &message })).into_response()
    }
}

impl From<EmailErr> for SendMessageError {
    fn from(err: EmailErr) -> Self {
        match &err {
            EmailErr::MessageNotFound(_) => SendMessageError::NotFound(err.to_string()),
            EmailErr::MessageAlreadySent(_)
            | EmailErr::CannotReplyToDraft
            | EmailErr::Base64DecodeError(_)
            | EmailErr::Utf8Error(_) => SendMessageError::Validation(err.to_string()),
            _ => SendMessageError::Internal(err),
        }
    }
}

/// Send a message.
#[utoipa::path(
    post,
    tag = "Messages",
    path = "/email/messages",
    operation_id = "send_message",
    request_body = SendMessageRequest,
    responses(
        (status = 201, body = SendMessageResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, link, body))]
pub async fn send_message_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T>>,
    Json(body): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, SendMessageError> {
    let input = body.into_domain();
    let created = state.inner.send_message(&link, input).await?;

    Ok((
        StatusCode::CREATED,
        Json(SendMessageResponse {
            message: created.into(),
        }),
    ))
}
