//! This module exposes the http adapter for inbound http requests via an axum router

#[cfg(test)]
mod test;

pub mod device;
pub mod preferences;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    routing::{delete, get, patch, put},
};
use decode_jwt::DecodedJwt;
use hmac::Hmac;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use model_error_response::ErrorResponse;
use models_pagination::{CreatedAt, CursorOptionExt, CursorWithValAndFilter};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::Sha256;
use std::{collections::HashSet, sync::Arc};
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
    /// the statically known list of notification typenames which can be blocked by the user
    pub blockable_notification_typenames: &'static HashSet<&'static str>,
    /// The value which is used to verify the presigned url requests
    pub hmac_signing_key: Hmac<Sha256>,
    /// the args used to validate jwts
    pub jwt_args: JwtValidationArgs,
}

impl<S> FromRef<NotificationRouterState<S>> for JwtValidationArgs {
    fn from_ref(input: &NotificationRouterState<S>) -> Self {
        input.jwt_args.clone()
    }
}

impl<S> Clone for NotificationRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            blockable_notification_typenames: self.blockable_notification_typenames,
            hmac_signing_key: self.hmac_signing_key.clone(),
            jwt_args: self.jwt_args.clone(),
        }
    }
}

impl<S: NotificationReader> NotificationRouterState<S> {
    /// create a new instance of self
    pub fn new(
        val: S,
        blockable_notification_typenames: &'static HashSet<&'static str>,
        hmac_signing_key: Hmac<Sha256>,
        jwt_args: JwtValidationArgs,
    ) -> Self {
        NotificationRouterState {
            inner: Arc::new(val),
            blockable_notification_typenames,
            hmac_signing_key,
            jwt_args,
        }
    }
}

/// construct the router
pub fn router<S: NotificationReader, T: Serialize + DeserializeOwned + Send + 'static>()
-> Router<NotificationRouterState<S>> {
    Router::new()
        .nest(
            "/bulk",
            Router::new()
                .route("/", delete(bulk_delete_notifications))
                .route("/seen", patch(bulk_mark_seen))
                .route("/done", patch(bulk_mark_done))
                .route("/undone", patch(bulk_mark_undone)),
        )
        .route(
            "/preferences",
            get(preferences::get_notification_type_preferences),
        )
        .route(
            "/preferences/{notification_event_type}/disable",
            put(preferences::disable_notification_type)
                .get(preferences::presigned_disable_notification_type),
        )
        .route(
            "/preferences/{notification_event_type}/enable",
            put(preferences::enable_notification_type),
        )
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
    decoded_jwt: DecodedJwt,
    Query(Params { limit }): Query<Params>,
    cursor: Option<CursorWithValAndFilter<Uuid, CreatedAt, ()>>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let query = cursor.into_query(CreatedAt, ());
    let result = service
        .inner
        .get_user_notifications::<T>(decoded_jwt.macro_user_id, limit, query)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notifications".into(),
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
    decoded_jwt: DecodedJwt,
    Query(Params { limit }): Query<Params>,
    cursor: Option<CursorWithValAndFilter<Uuid, CreatedAt, ()>>,
    Json(req): Json<BulkGetByEventItemIdsRequest>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notifications_by_event_item_ids::<T>(GetNotificationsByEventItemIdsRequest {
            user_id: decoded_jwt.macro_user_id,
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
                    message: "failed to get notifications".into(),
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
    decoded_jwt: DecodedJwt,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &decoded_jwt, &req, NotificationStatus::Seen).await
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
    decoded_jwt: DecodedJwt,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &decoded_jwt, &req, NotificationStatus::Done(true)).await
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
    decoded_jwt: DecodedJwt,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(
        &service,
        &decoded_jwt,
        &req,
        NotificationStatus::Done(false),
    )
    .await
}

async fn bulk_update<S: NotificationReader>(
    service: &NotificationRouterState<S>,
    decoded_jwt: &DecodedJwt,
    req: &NotificationBulkRequest,
    status: NotificationStatus,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .update_notifications(UpdateNotificationsRequest {
            user_id: decoded_jwt.macro_user_id.clone(),
            notification_ids: &req.notification_ids,
            status,
        })
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to update notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to update notifications".into(),
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
    decoded_jwt: DecodedJwt,
    Path(EventItemIdPath { event_item_id }): Path<EventItemIdPath>,
    Query(Params { limit }): Query<Params>,
    cursor: Option<CursorWithValAndFilter<Uuid, CreatedAt, ()>>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notifications_by_event_item_ids::<T>(GetNotificationsByEventItemIdsRequest {
            user_id: decoded_jwt.macro_user_id,
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
                    message: "failed to get notifications".into(),
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
    decoded_jwt: DecodedJwt,
    Path(NotificationIdPath { notification_id }): Path<NotificationIdPath>,
) -> Result<Json<UserNotificationRow<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let result = service
        .inner
        .get_user_notification_by_id::<T>(decoded_jwt.macro_user_id, notification_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user notification by id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notification".into(),
                }),
            )
        })?;

    let Some(notification) = result else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "notification not found".into(),
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
    decoded_jwt: DecodedJwt,
    Path(NotificationIdPath { notification_id }): Path<NotificationIdPath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .delete_user_notification(decoded_jwt.macro_user_id, notification_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete user notification");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to delete notification".into(),
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
    decoded_jwt: DecodedJwt,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    service
        .inner
        .bulk_delete_user_notifications(decoded_jwt.macro_user_id, &req.notification_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete user notifications");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to delete notifications".into(),
                }),
            )
        })?;

    Ok(Json(()))
}
