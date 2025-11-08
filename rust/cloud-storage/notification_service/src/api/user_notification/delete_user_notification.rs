use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::ApiContext;
use model::user::UserContext;

#[derive(serde::Deserialize)]
pub struct Params {
    pub notification_id: String,
}

/// Marks the user's notification as deleted.
#[utoipa::path(
        delete,
        operation_id = "delete_user_notification",
        path = "/user_notifications/{notification_id}",
        params(
            ("notification_id" = String, Path, description = "ID of the notification")
        ),
        responses(
            (status = 200, body=EmptyResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { notification_id }): Path<Params>,
) -> Result<Response, Response> {
    notification_db_client::user_notification::delete::delete_user_notification(
        &ctx.db,
        &notification_id,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to delete user notification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to delete user notification",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
