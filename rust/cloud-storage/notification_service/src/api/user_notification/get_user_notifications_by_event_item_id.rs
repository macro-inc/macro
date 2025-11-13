use crate::api::{
    context::ApiContext, user_notification::get_user_notification::GetAllUserNotificationsResponse,
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use model::response::ErrorResponse;
use model::user::UserContext;
use model_notifications::UserNotification;
use models_pagination::{CreatedAt, CursorExtractor, PaginateOn, Paginated, TypeEraseCursor};
use sqlx::types::Uuid;

#[derive(serde::Deserialize)]
pub struct PathParams {
    pub event_item_id: String,
}

#[derive(serde::Deserialize)]
pub struct Params {
    pub limit: Option<u32>,
}

/// Gets the user's notifications for a given event item id in a paginated format.
#[utoipa::path(
        get,
        operation_id = "get_user_notifications_by_event_item_id",
        path = "/user_notifications/item/{event_item_id}",
        params(
            ("event_item_id" = String, Path, description = "The event item id"),
            ("limit" = i64, Query, description = "Size limit per page. Default 20, max 500."),
            ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id, separated by |."),
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
    Path(PathParams { event_item_id }): Path<PathParams>,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse>, (StatusCode, Json<ErrorResponse<'static>>)> {
    tracing::info!("get_user_notifications_by_event_item_id");

    let limit = limit.unwrap_or(20).min(500);

    let result =
        notification_db_client::user_notification::get::get_all::get_all_user_notifications_by_event_item_ids(
            &ctx.db,
            &user_context.user_id,
            &[&event_item_id],
            limit,
            cursor.into_query(CreatedAt)
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

    let Paginated {
        items, next_cursor, ..
    } = result;
    Ok(Json(GetAllUserNotificationsResponse { items, next_cursor }))
}
