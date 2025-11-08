use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::{
    api::context::ApiContext, model::user_notification::NotificationBulkRequest, notification,
};

use model::user::UserContext;

/// Marks the user's notifications as seen
#[utoipa::path(
        patch,
        operation_id = "bulk_mark_user_notification_seen",
        path = "/user_notifications/bulk/seen",
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
    tracing::info!("bulk_mark_user_notification_seen");

    let notification_ids = req.notification_ids;
    notification_db_client::user_notification::patch::seen::bulk_patch_seen(
        &ctx.db,
        &user_context.user_id,
        &notification_ids,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to patch user notifications seen");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to patch user notifications seen",
            }),
        )
            .into_response()
    })?;

    if let Err(e) = notification::send::push::remove::clear_push_notifications(
        ctx.clone(),
        &notification_ids,
        &user_context.user_id,
    ) {
        tracing::error!(error=?e, "failed to remove push notifications");
    }

    tokio::spawn({
        let db = ctx.db.clone();
        let user_id = user_context.user_id.clone();
        let notification_ids = notification_ids.clone();
        async move {
            if let Err(e) = notification_db_client::channel_notification_email_sent::delete::delete_channel_notification_email_sent_by_notification_ids(
                &db,
                &user_id,
                &notification_ids,
            )
            .await
            {
                tracing::error!(error=?e, "failed to delete channel notification email sent");
            }
        }
    });

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
