use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::{api::context::ApiContext, model::user_notification::NotificationBulkRequest};
use model::user::UserContext;

#[derive(Debug, thiserror::Error)]
pub enum BulkMarkUserNotificationUndoneError {
    #[error("failed to patch user notifications undone")]
    InternalServerError(#[from] anyhow::Error),
}

impl IntoResponse for BulkMarkUserNotificationUndoneError {
    fn into_response(self) -> Response {
        match self {
            BulkMarkUserNotificationUndoneError::InternalServerError(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: &e.to_string(),
                }),
            )
                .into_response(),
        }
    }
}

/// Marks the user's notifications as undone.
#[utoipa::path(
        patch,
        operation_id = "bulk_mark_user_notification_undone",
        path = "/user_notifications/bulk/undone",
        responses(
            (status = 200, body=EmptyResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<EmptyResponse>, BulkMarkUserNotificationUndoneError> {
    tracing::info!("bulk_mark_user_notification_undone");

    let notification_ids = req.notification_ids;
    notification_db_client::user_notification::patch::done::bulk_patch_done(
        &ctx.db,
        &user_context.user_id,
        &notification_ids,
        false,
    )
    .await?;

    Ok(Json(EmptyResponse::default()))
}
