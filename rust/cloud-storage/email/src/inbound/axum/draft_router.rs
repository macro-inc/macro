use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::post};
use axum_extra::extract::Cached;
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::{
    EmailLinkExtractor, EmailRouterState,
    api_types::{CreateDraftRequest, CreateDraftResponse},
};

/// Create the draft router with a `POST /` handler.
pub fn draft_router<S, T>(state: EmailRouterState<T>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: EmailService,
{
    Router::new()
        .route("/", post(create_draft_handler::<T>))
        .with_state(state)
}

/// Errors from the create draft handler.
#[derive(Debug, Error)]
pub enum CreateDraftError {
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

impl IntoResponse for CreateDraftError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, CreateDraftError::Internal(_)) {
            tracing::error!(error=?self, "create draft error");
        }

        let status = match &self {
            CreateDraftError::Validation(_) => StatusCode::BAD_REQUEST,
            CreateDraftError::NotFound(_) => StatusCode::NOT_FOUND,
            CreateDraftError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailErr> for CreateDraftError {
    fn from(err: EmailErr) -> Self {
        match &err {
            EmailErr::MessageNotFound(_) => CreateDraftError::NotFound(err.to_string()),
            EmailErr::MessageAlreadySent(_)
            | EmailErr::CannotReplyToDraft
            | EmailErr::Base64DecodeError(_)
            | EmailErr::Utf8Error(_) => CreateDraftError::Validation(err.to_string()),
            _ => CreateDraftError::Internal(err),
        }
    }
}

/// Create a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts",
    operation_id = "create_draft",
    request_body = CreateDraftRequest,
    responses(
        (status = 201, body = CreateDraftResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, link, body))]
pub async fn create_draft_handler<T: EmailService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T>>,
    Json(body): Json<CreateDraftRequest>,
) -> Result<impl IntoResponse, CreateDraftError> {
    let input = body.into_domain();
    let draft = state.inner.create_draft(&link, input).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateDraftResponse {
            draft: draft.into(),
        }),
    ))
}
