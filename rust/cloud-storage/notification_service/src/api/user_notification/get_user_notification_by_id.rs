use axum::{
    Extension, Json,
    extract::rejection::PathRejection,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use model::user::UserContext;
use model_notifications::UserNotification;
use uuid::Uuid;

use crate::api::context::ApiContext;

#[derive(Debug, serde::Deserialize)]
pub struct Params {
    pub notification_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum GetNotificationErr {
    #[error("invalid notification_id")]
    InvalidNotificationId,
    #[error("notification not found")]
    NotFound,
    #[error("failed to get user notification by id")]
    Db(#[source] anyhow::Error),
    #[error("failed to convert notification")]
    Convert(#[source] anyhow::Error),
}

impl IntoResponse for GetNotificationErr {
    fn into_response(self) -> Response {
        match self {
            GetNotificationErr::InvalidNotificationId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid notification_id",
                }),
            )
                .into_response(),
            GetNotificationErr::NotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "notification not found",
                }),
            )
                .into_response(),
            GetNotificationErr::Db(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get user notification by id",
                }),
            )
                .into_response(),
            GetNotificationErr::Convert(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to convert notification",
                }),
            )
                .into_response(),
        }
    }
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    path: Result<Path<Params>, PathRejection>,
) -> Result<Json<UserNotification>, GetNotificationErr> {
    let Path(Params { notification_id }) =
        path.map_err(|_| GetNotificationErr::InvalidNotificationId)?;

    let raw =
        notification_db_client::user_notification::get::get_by_id::get_user_notification_by_id(
            &ctx.db,
            &user_context.user_id,
            notification_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notification by id");
            GetNotificationErr::Db(e)
        })?;

    let raw = raw.ok_or(GetNotificationErr::NotFound)?;

    let notification = UserNotification::try_from(raw).map_err(|e| {
        tracing::error!(error=?e, "failed to convert notification");
        GetNotificationErr::Convert(e)
    })?;

    Ok(Json(notification))
}
