//! This module exposes the http adapter for inbound http requests via an axum router

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::patch,
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{CreatedAt, CursorExtractor};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    models::{
        UserNotificationRow,
        request::{
            GetNotificationsByEventItemIdsRequest, NotificationStatus, UpdateNotificationsRequest,
        },
    },
    service::NotificationReader,
};

/// Path parameter for a single event item ID.
#[derive(Deserialize)]
pub struct EventItemIdPath {
    /// The event item ID.
    pub event_item_id: Uuid,
}

/// Path parameter for a single notification ID.
#[derive(Deserialize)]
pub struct NotificationIdPath {
    /// The notification ID.
    pub notification_id: Uuid,
}

/// the router state for a notification router
pub struct NotificationRouterState<S> {
    /// the inner S wrapped in an [Arc]
    pub inner: Arc<S>,
}

impl<S> Clone for NotificationRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: NotificationReader> NotificationRouterState<S> {
    /// create a new instance of self
    pub fn new(val: S) -> Self {
        NotificationRouterState {
            inner: Arc::new(val),
        }
    }
}

/// construct the router
pub fn router<S: NotificationReader, T: Serialize + DeserializeOwned + Send + 'static>()
-> Router<NotificationRouterState<S>> {
    Router::new()
        .route("/bulk/seen", patch(bulk_mark_seen))
        .route("/bulk/done", patch(bulk_mark_done))
        .route("/bulk/undone", patch(bulk_mark_undone))
}

/// the params for pagination
#[derive(serde::Deserialize)]
pub struct Params {
    /// the limit on the number of items to return in a page
    pub limit: Option<u32>,
}

/// the response from listing the users notifications
#[derive(Debug, Serialize)]
pub struct GetAllUserNotificationsResponse<T> {
    /// the list of items returned
    pub items: Vec<UserNotificationRow<T>>,
    /// the next page cursor if it exists
    pub next_cursor: Option<String>,
}

/// List user notifications with generic metadata type `T`.
pub async fn list_user_notifications<
    S: NotificationReader,
    T: Serialize + DeserializeOwned + Send,
>(
    service: &NotificationRouterState<S>,
    macro_user: MacroUserExtractor,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let query = cursor.into_query(CreatedAt, ());
    let result = service
        .inner
        .get_user_notifications::<T>(macro_user.macro_user_id, limit, query)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notifications",
                }),
            )
        })?;

    Ok(Json(GetAllUserNotificationsResponse {
        items: result.items,
        next_cursor: result.next_cursor,
    }))
}

/// Request body for bulk-fetching notifications by event item IDs.
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BulkGetByEventItemIdsRequest {
    /// The event item IDs to filter notifications by.
    pub event_item_ids: Vec<Uuid>,
}

/// Get user notifications filtered by event item IDs.
#[utoipa::path(
    post,
    operation_id = "bulk_get_user_notifications_by_event_item_ids",
    path = "/v2/user_notifications/item/bulk",
    params(
        ("limit" = Option<u32>, Query, description = "Size limit per page. Default 20, max 500."),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id."),
    ),
    request_body = BulkGetByEventItemIdsRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn bulk_get_by_event_item_ids<
    S: NotificationReader,
    T: Serialize + DeserializeOwned + Send,
>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
    Json(req): Json<BulkGetByEventItemIdsRequest>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notifications_by_event_item_ids::<T>(GetNotificationsByEventItemIdsRequest {
            user_id: macro_user.macro_user_id,
            event_item_ids: &req.event_item_ids,
            limit,
            cursor: cursor.into_query(CreatedAt, ()),
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notifications by event item ids");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notifications",
                }),
            )
        })?;

    Ok(Json(GetAllUserNotificationsResponse {
        items: result.items,
        next_cursor: result.next_cursor,
    }))
}

/// the notification ids that we are bulk updating
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBulkRequest {
    /// The ids of the notifications to handle
    pub notification_ids: Vec<uuid::Uuid>,
}

/// Mark notifications as seen.
#[utoipa::path(
    patch,
    operation_id = "bulk_mark_notifications_seen",
    path = "/v2/user_notifications/bulk/seen",
    request_body = NotificationBulkRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn bulk_mark_seen<S: NotificationReader>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Seen).await
}

/// Mark notifications as done.
#[utoipa::path(
    patch,
    operation_id = "bulk_mark_notifications_done",
    path = "/v2/user_notifications/bulk/done",
    request_body = NotificationBulkRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn bulk_mark_done<S: NotificationReader>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Done(true)).await
}

/// Mark notifications as not done.
#[utoipa::path(
    patch,
    operation_id = "bulk_mark_notifications_undone",
    path = "/v2/user_notifications/bulk/undone",
    request_body = NotificationBulkRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn bulk_mark_undone<S: NotificationReader>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Done(false)).await
}

async fn bulk_update<S: NotificationReader>(
    service: &NotificationRouterState<S>,
    macro_user: &MacroUserExtractor,
    req: &NotificationBulkRequest,
    status: NotificationStatus,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .update_notifications(UpdateNotificationsRequest {
            user_id: macro_user.macro_user_id.clone(),
            notification_ids: &req.notification_ids,
            status,
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to update notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to update notifications",
                }),
            )
        })?;

    Ok(Json(()))
}

/// Get user notifications for a single event item ID.
#[utoipa::path(
    get,
    operation_id = "get_user_notifications_by_event_item_id",
    path = "/v2/user_notifications/item/{event_item_id}",
    params(
        ("event_item_id" = Uuid, Path, description = "The event item ID"),
        ("limit" = Option<u32>, Query, description = "Size limit per page. Default 20, max 500."),
        ("cursor" = Option<String>, Query, description = "Cursor value. Base64 encoded timestamp and item id."),
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_by_event_item_id<S: NotificationReader, T: Serialize + DeserializeOwned + Send>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Path(EventItemIdPath { event_item_id }): Path<EventItemIdPath>,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notifications_by_event_item_ids::<T>(GetNotificationsByEventItemIdsRequest {
            user_id: macro_user.macro_user_id,
            event_item_ids: &[event_item_id],
            limit,
            cursor: cursor.into_query(CreatedAt, ()),
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notifications by event item id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notifications",
                }),
            )
        })?;

    Ok(Json(GetAllUserNotificationsResponse {
        items: result.items,
        next_cursor: result.next_cursor,
    }))
}

/// Get a single user notification by ID.
#[utoipa::path(
    get,
    operation_id = "get_user_notification_by_id_v2",
    path = "/v2/user_notifications/{notification_id}",
    params(
        ("notification_id" = Uuid, Path, description = "ID of the notification"),
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_notification_by_id<
    S: NotificationReader,
    T: Serialize + DeserializeOwned + Send,
>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Path(NotificationIdPath { notification_id }): Path<NotificationIdPath>,
) -> Result<Json<UserNotificationRow<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notification_by_id::<T>(macro_user.macro_user_id, notification_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notification by id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notification",
                }),
            )
        })?;

    let Some(notification) = result else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "notification not found",
            }),
        ));
    };

    Ok(Json(notification))
}

/// Soft-delete a single user notification.
#[utoipa::path(
    delete,
    operation_id = "delete_user_notification_v2",
    path = "/v2/user_notifications/{notification_id}",
    params(
        ("notification_id" = Uuid, Path, description = "ID of the notification"),
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn delete_notification<S: NotificationReader>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Path(NotificationIdPath { notification_id }): Path<NotificationIdPath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .delete_user_notification(macro_user.macro_user_id, notification_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete user notification");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to delete notification",
                }),
            )
        })?;

    Ok(Json(()))
}

/// Soft-delete multiple user notifications.
#[utoipa::path(
    delete,
    operation_id = "bulk_delete_user_notifications_v2",
    path = "/v2/user_notifications/bulk",
    request_body = NotificationBulkRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn bulk_delete_notifications<S: NotificationReader>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .bulk_delete_user_notifications(macro_user.macro_user_id, &req.notification_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete user notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to delete notifications",
                }),
            )
        })?;

    Ok(Json(()))
}
