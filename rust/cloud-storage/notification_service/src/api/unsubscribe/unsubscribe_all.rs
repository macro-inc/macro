use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::ApiContext;

use model::user::UserContext;

/// Unsubscribes user from all notifications.
#[utoipa::path(
        post,
        operation_id = "unsubscribe_all",
        path = "/unsubscribe/mute",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    notification_db_client::user_mute_notification::upsert_user_mute_notification(
        &ctx.db,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to mute all notifications");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to mute all notifications",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
