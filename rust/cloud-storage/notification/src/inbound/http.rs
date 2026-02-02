//! This module exposes the http adapter for inbound http requests via an axum router

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, patch},
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
        request::{NotificationStatus, UpdateNotificationsRequest},
    },
    service::NotificationIngress,
};

/// the router state for a notification router
pub struct NotificationRouterState<S> {
    inner: Arc<S>,
}

impl<S> Clone for NotificationRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<S: NotificationIngress> NotificationRouterState<S> {
    /// create a new instance of self
    pub fn new(val: S) -> Self {
        NotificationRouterState {
            inner: Arc::new(val),
        }
    }
}

/// construct the router
pub fn router<S: NotificationIngress, T: Serialize + DeserializeOwned + Send + 'static>()
-> Router<NotificationRouterState<S>> {
    Router::new()
        .route("/", get(list_user_notifications::<S, T>))
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
    S: NotificationIngress,
    T: Serialize + DeserializeOwned + Send,
>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    let query = cursor.into_query(CreatedAt, ());
    let result = service
        .inner
        .get_user_notifications::<T>(macro_user.macro_user_id.as_ref(), limit, query)
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

/// the notification ids that we are bulk updating
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBulkRequest {
    /// The ids of the notifications to handle
    pub notification_ids: Vec<uuid::Uuid>,
}

async fn bulk_mark_seen<S: NotificationIngress>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Seen).await
}

async fn bulk_mark_done<S: NotificationIngress>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Done(true)).await
}

async fn bulk_mark_undone<S: NotificationIngress>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    bulk_update(&service, &macro_user, &req, NotificationStatus::Done(false)).await
}

async fn bulk_update<S: NotificationIngress>(
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
