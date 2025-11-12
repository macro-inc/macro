use crate::api::context::ApiContext;
use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
};
use model::response::ErrorResponse;
use model::user::UserContext;
use model_notifications::UserNotification;
use models_pagination::{CreatedAt, CursorExtractor, PaginateOn, Paginated};
use notification_db_client::user_notification::get::get_all::get_all_user_notifications;
use serde::Serialize;
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Deserialize)]
pub struct Params {
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetAllUserNotificationsResponse {
    pub items: Vec<UserNotification>,
    pub next_cursor: Option<String>,
}

/// Gets the user's unseen notifications in a paginated format.
#[utoipa::path(
        get,
        operation_id = "get_user_notification",
        path = "/user_notifications",
        params(
            ("limit" = i64, Query, description = "Size limit per page. Default 20, max 500."),
            ("cursor" = Option<String>, Query, description = "Base 64 encoded cursor"),
        ),
        responses(
            (status = 200, body=GetAllUserNotificationsResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    tracing::info!("get_all_user_notifications");

    let limit = limit.unwrap_or(20).min(500);

    let result = get_all_user_notifications(
        &ctx.db,
        &user_context.user_id,
        limit,
        cursor.into_query(CreatedAt),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to get user notifications");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to get user notifications",
            }),
        )
    })?
    .into_iter()
    .map(UserNotification::try_from)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| {
        tracing::error!(error=?e, "failed to convert notification");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "failed to convert notification",
            }),
        )
    })?
    .into_iter()
    .paginate_on(limit as usize, CreatedAt)
    .into_page()
    .type_erase();

    // Delete the notification email sent for the user since they are requesting their
    // notifications
    tokio::spawn(async move {
        let _ = notification_db_client::notification_email_sent::delete::delete_notification_email_sent(
            &ctx.db,
            &user_context.user_id,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "failed to delete notification email sent");
        });
    });

    let Paginated {
        items, next_cursor, ..
    } = result;
    Ok(Json(GetAllUserNotificationsResponse { items, next_cursor }))
}
