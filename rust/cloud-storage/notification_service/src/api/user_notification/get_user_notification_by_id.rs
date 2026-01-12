use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use model::response::ErrorResponse;
use model::user::UserContext;
use model_notifications::UserNotification;
use sqlx::types::Uuid;

use crate::api::context::ApiContext;

#[derive(serde::Deserialize)]
pub struct Params {
    pub notification_id: String,
}

/// Gets a single user notification by id.
#[utoipa::path(
        get,
        operation_id = "get_user_notification_by_id",
        path = "/user_notifications/{notification_id}",
        params(
            ("notification_id" = String, Path, description = "ID of the notification")
        ),
        responses(
            (status = 200, body=UserNotification),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { notification_id }): Path<Params>,
) -> Result<Json<UserNotification>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let notification_uuid = Uuid::parse_str(&notification_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "invalid notification_id",
            }),
        )
    })?;

    let raw =
        notification_db_client::user_notification::get::get_by_id::get_user_notification_by_id(
            &ctx.db,
            &user_context.user_id,
            notification_uuid,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notification by id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get user notification by id",
                }),
            )
        })?;

    let Some(raw) = raw else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "notification not found",
            }),
        ));
    };

    let notification = UserNotification::try_from(raw).map_err(|e| {
        tracing::error!(error=?e, "failed to convert notification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to convert notification",
            }),
        )
    })?;

    Ok(Json(notification))
}
