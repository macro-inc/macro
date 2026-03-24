use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::patch,
};
use model_error_response::ErrorResponse;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    models::EmailErr,
    ports::{EmailService, GmailTokenProvider},
};

use super::{EmailRouterState, GmailAccessTokenExtractor, GmailTokenState};

/// Request body for updating a thread's labels.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct UpdateThreadLabelRequest {
    pub label_id: Uuid,
    pub value: bool,
}

/// Response body for updating a thread's labels.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
pub struct UpdateThreadLabelsResponse {
    pub successful_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
}

/// Errors from the update thread labels handler.
#[derive(Debug, Error)]
pub enum UpdateThreadLabelError {
    /// Validation / bad request.
    #[error("{0}")]
    Validation(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for UpdateThreadLabelError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, UpdateThreadLabelError::Internal(_)) {
            tracing::error!(error=?self, "update thread labels error");
        }

        let status = match &self {
            UpdateThreadLabelError::Validation(_) => StatusCode::BAD_REQUEST,
            UpdateThreadLabelError::NotFound(_) => StatusCode::NOT_FOUND,
            UpdateThreadLabelError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (status, Json(ErrorResponse { message: &message })).into_response()
    }
}

impl From<EmailErr> for UpdateThreadLabelError {
    fn from(err: EmailErr) -> Self {
        match &err {
            EmailErr::LabelNotFound => UpdateThreadLabelError::NotFound(err.to_string()),
            EmailErr::ThreadEmpty => UpdateThreadLabelError::NotFound(err.to_string()),
            EmailErr::EmptyProviderLabelId => UpdateThreadLabelError::Validation(err.to_string()),
            _ => UpdateThreadLabelError::Internal(err),
        }
    }
}

/// Create the thread labels router with a `PATCH /{id}/labels` handler.
pub fn thread_labels_router<S, T, G>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    G: GmailTokenProvider,
    EmailRouterState<T>: axum::extract::FromRef<S>,
    GmailTokenState<G>: axum::extract::FromRef<S>,
{
    Router::new().route("/{id}/labels", patch(update_thread_labels_handler::<T, G>))
}

/// Add or remove a label from all messages in a thread.
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/{id}/labels",
    operation_id = "add_remove_thread_label",
    request_body = UpdateThreadLabelRequest,
    params(
        ("id" = Uuid, Path, description = "Thread ID."),
    ),
    responses(
        (status = 200, body = UpdateThreadLabelsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, gmail_extractor, body))]
pub async fn update_thread_labels_handler<T: EmailService, G: GmailTokenProvider>(
    State(state): State<EmailRouterState<T>>,
    gmail_extractor: GmailAccessTokenExtractor<T, G>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateThreadLabelRequest>,
) -> Result<Json<UpdateThreadLabelsResponse>, UpdateThreadLabelError> {
    let result = state
        .inner
        .update_thread_labels(
            &gmail_extractor.access_token,
            &gmail_extractor.link,
            thread_id,
            body.label_id,
            body.value,
        )
        .await?;

    Ok(Json(UpdateThreadLabelsResponse {
        successful_ids: result.successful_ids,
        failed_ids: result.failed_ids,
    }))
}
