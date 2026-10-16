use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch},
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::previews_router::EmailRouterState;

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
    /// The caller cannot change the thread.
    #[error("You do not have permission to perform this action")]
    Forbidden,
    /// A delivery or thread-state transition prevents the operation.
    #[error("{0}")]
    Conflict(String),
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
            UpdateThreadLabelError::Forbidden => StatusCode::FORBIDDEN,
            UpdateThreadLabelError::Conflict(_) => StatusCode::CONFLICT,
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
            EmailErr::ThreadNotFound
            | EmailErr::LabelNotFound
            | EmailErr::InboxNotFound
            | EmailErr::MessageNotFound(_) => UpdateThreadLabelError::NotFound(err.to_string()),
            EmailErr::ThreadEmpty => UpdateThreadLabelError::NotFound(err.to_string()),
            EmailErr::EmptyProviderLabelId => UpdateThreadLabelError::Validation(err.to_string()),
            EmailErr::Unauthorized => UpdateThreadLabelError::Forbidden,
            EmailErr::InvalidDraft(_)
            | EmailErr::MessageDeliveryConflict(_)
            | EmailErr::MessageAlreadySent(_)
            | EmailErr::ThreadHasNoInboundMessages => {
                UpdateThreadLabelError::Conflict(err.to_string())
            }
            _ => UpdateThreadLabelError::Internal(err),
        }
    }
}

/// Create the thread labels router with a `PATCH /{id}/labels` handler.
pub fn thread_labels_router<S, T, Auth>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    Auth: MacroAuthorizationService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
    MacroAuthorizationState<Auth>: axum::extract::FromRef<S>,
{
    Router::new()
        .route(
            "/{id}/operations",
            get(thread_operations_handler::<T, Auth>),
        )
        .route(
            "/{id}/labels",
            patch(update_thread_labels_handler::<T, Auth>),
        )
        .route("/{id}/state", patch(update_thread_state_handler::<T, Auth>))
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
#[tracing::instrument(err, skip(state, macro_user, body))]
pub async fn update_thread_labels_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(macro_user): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateThreadLabelRequest>,
) -> Result<Json<UpdateThreadLabelsResponse>, UpdateThreadLabelError> {
    let result = state
        .inner
        .update_thread_labels_for_user(
            macro_user.authorization.user.macro_user_id.clone(),
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

/// Semantic mailbox facts, independent of folder/category names.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ThreadStateField {
    Read,
    Starred,
    Trashed,
    Junk,
}
/// Desired state for every applicable message in an authorized thread.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct UpdateThreadStateRequest {
    pub field: ThreadStateField,
    pub value: bool,
}

/// Set mailbox state without client-side provider label lookup.
#[utoipa::path(patch,tag="Threads",path="/email/threads/{id}/state",operation_id="update_thread_state",request_body=UpdateThreadStateRequest,
    params(("id"=Uuid,Path,description="Thread ID")),responses((status=204),(status=400,body=ErrorResponse),(status=401,body=ErrorResponse),(status=404,body=ErrorResponse),(status=409,body=ErrorResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn update_thread_state_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(actor): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(thread): Path<Uuid>,
    Json(input): Json<UpdateThreadStateRequest>,
) -> Result<StatusCode, UpdateThreadLabelError> {
    use crate::domain::models::mailbox_action::MailboxAction;
    let action = match input.field {
        ThreadStateField::Read => MailboxAction::Read(input.value),
        ThreadStateField::Starred => MailboxAction::Flagged(input.value),
        ThreadStateField::Trashed => MailboxAction::Trashed(input.value),
        ThreadStateField::Junk => MailboxAction::Junk(input.value),
    };
    state
        .inner
        .change_thread_mailbox_state(actor.authorization.user.macro_user_id, thread, action)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Fetch the latest organization action outcomes without provider-specific status strings.
#[utoipa::path(get,tag="Threads",path="/email/threads/{id}/operations",operation_id="thread_operations",
    params(("id"=Uuid,Path,description="Thread ID")),responses((status=200,body=Vec<crate::domain::models::mailbox_action::MailboxOperation>),(status=404,body=ErrorResponse)))]
pub async fn thread_operations_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(actor): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(thread): Path<Uuid>,
) -> Result<
    Json<Vec<crate::domain::models::mailbox_action::MailboxOperation>>,
    UpdateThreadLabelError,
> {
    Ok(Json(
        state
            .inner
            .thread_mailbox_operations(actor.authorization.user.macro_user_id, thread)
            .await?,
    ))
}
