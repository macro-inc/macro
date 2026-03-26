use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::link::Link;
use models_email::email::service::pubsub::LinkManagerMessage;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum DisableSyncError {
    #[error("Failed to enqueue delete notification")]
    EnqueueError(#[from] anyhow::Error),
}

impl IntoResponse for DisableSyncError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DisableSyncError::EnqueueError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Disables inbox syncing for user.
#[utoipa::path(
    delete,
    tag = "Sync",
    path = "/email/sync",
    operation_id = "disable_sync",
    responses(
            (status = 204, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn disable_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
) -> Result<Response, DisableSyncError> {
    tracing::info!(user_id = %user_context.user_id, "Disable called");

    // Enqueue the delete operation to handle cleanup asynchronously
    let message = LinkManagerMessage::DeleteLink { link_id: link.id };

    ctx.sqs_client
        .enqueue_link_manager_notification(message)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, link_id=?link.id, "Failed to enqueue delete notification");
        })?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
