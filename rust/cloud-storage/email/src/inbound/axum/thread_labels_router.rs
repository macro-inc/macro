use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::patch,
};
use axum_extra::extract::Cached;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    models::EmailErr,
    ports::{EmailService, GmailTokenProvider},
};

use super::{axum_impls::GmailTokenState, previews_router::EmailRouterState};

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
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
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
#[tracing::instrument(err, skip(state, token_state, macro_user, body))]
pub async fn update_thread_labels_handler<T: EmailService, G: GmailTokenProvider>(
    State(state): State<EmailRouterState<T>>,
    State(token_state): State<GmailTokenState<G>>,
    Cached(macro_user): Cached<MacroUserExtractor>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateThreadLabelRequest>,
) -> Result<Json<UpdateThreadLabelsResponse>, UpdateThreadLabelError> {
    // Resolve the inbox from the thread (scoped to the caller's own inboxes),
    // then use that inbox's own Gmail token.
    let link = state
        .inner
        .get_owned_link_for_thread(&macro_user.user_context.fusion_user_id, thread_id)
        .await?
        .ok_or_else(|| UpdateThreadLabelError::NotFound("Thread not found".to_string()))?;

    let access_token = token_state.inner.fetch_gmail_access_token(&link).await?;

    let result = state
        .inner
        .update_thread_labels(&access_token, &link, thread_id, body.label_id, body.value)
        .await?;

    Ok(Json(UpdateThreadLabelsResponse {
        successful_ids: result.successful_ids,
        failed_ids: result.failed_ids,
    }))
}
