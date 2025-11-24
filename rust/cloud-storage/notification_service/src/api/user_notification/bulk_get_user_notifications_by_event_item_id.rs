use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
};
use model::response::ErrorResponse;
use model_notifications::UserNotification;
use models_pagination::{
    CreatedAt, CursorExtractor, PaginateOn, PaginatedOpaqueCursor, TypeEraseCursor,
};
use sqlx::types::Uuid;

use crate::api::{
    context::ApiContext, user_notification::get_user_notification::GetAllUserNotificationsResponse,
};

use model::user::UserContext;

#[derive(serde::Deserialize, serde::Serialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkGetUserNotificationsByEventItemIdRequest {
    pub event_item_ids: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct Params {
    pub limit: Option<u32>,
}

type BulkResponse = Result<
    (StatusCode, Json<PaginatedOpaqueCursor<UserNotification>>),
    (StatusCode, Json<ErrorResponse<'static>>),
>;

/// Gets the user's notifications for a provided event item ids in a paginated format.
/// This will only return unseen notifications.
#[utoipa::path(
        post,
        operation_id = "bulk_get_user_notifications_by_event_item_id",
        path = "/user_notifications/item/bulk",
        params(
            ("limit" = u32, Query, description = "Size limit per page. Default 20, max 500."),
            ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id, separated by |."),
        ),
        request_body=BulkGetUserNotificationsByEventItemIdRequest,
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
    Json(req): Json<BulkGetUserNotificationsByEventItemIdRequest>,
) -> BulkResponse {
    tracing::info!("bulk_get_user_notifications_by_event_item_id");

    let limit = limit.unwrap_or(20).min(500);

    let result =
        notification_db_client::user_notification::get::get_all::get_all_user_notifications_by_event_item_ids(
            &ctx.db,
            &user_context.user_id,
            &req.event_item_ids,
            limit,
            cursor.into_query(CreatedAt, ())
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

    Ok((StatusCode::OK, Json(result)))
}
