use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::{ApiContext, AuthorizationService};

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
#[tracing::instrument(skip(ctx, user))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    notification_db_client::user_mute_notification::remove_user_mute_notification(
        &ctx.db,
        &user.authorization.user.user_context.user_id,
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
