use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::{api::context::ApiContext, model::user_notification::NotificationBulkRequest};

use model::user::UserContext;

/// Marks the user's notifications as deleted
#[utoipa::path(
        delete,
        operation_id = "bulk_delete_user_notification",
        path = "/user_notifications/bulk",
        responses(
            (status = 200, body=EmptyResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Response, Response> {
    let notification_ids = req.notification_ids;
    notification_db_client::user_notification::delete::bulk_delete_user_notification(
        &ctx.db,
        &user_context.user_id,
        &notification_ids,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to delete user notifications");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to delete user notifications",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
