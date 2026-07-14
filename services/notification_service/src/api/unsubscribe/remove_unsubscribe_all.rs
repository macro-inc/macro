use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use decode_jwt::DecodedJwt;
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::ApiContext;

/// Unmutes all notifications.
/// Existing notifications that were muted manually will remain muted.
#[utoipa::path(
        delete,
        operation_id = "remove_unsubscribe_all",
        path = "/unsubscribe/mute",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, decoded_jwt))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    decoded_jwt: DecodedJwt,
) -> Result<Response, Response> {
    notification_db_client::user_mute_notification::remove_user_mute_notification(
        &ctx.db,
        &decoded_jwt.user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to remove mute all notifications");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to remove mute all notifications".into(),
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
