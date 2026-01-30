//! This module exposes the http adapter for inbound http requests via an axum router

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, patch},
};
use chrono::serde::ts_seconds_option;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::{CreatedAt, CursorExtractor};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    models::{Notification, UserNotificationRow},
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
pub fn router<S: NotificationIngress, T: Serialize + DeserializeOwned + Send + 'static, O>(
    state: NotificationRouterState<S>,
) -> Router<O> {
    Router::new()
        .route("/", get(list_user_notifications::<S, T>))
        .route("/bulk/seen", patch(bulk_mark_seen))
        .route("/bulk/done", patch(bulk_mark_done))
        .route("/bulk/undone", patch(bulk_mark_undone))
        .with_state(state)
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

async fn list_user_notifications<S: NotificationIngress, T: Serialize + DeserializeOwned + Send>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    todo!()
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
    todo!()
}

async fn bulk_mark_done<S: NotificationIngress>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    todo!()
}

async fn bulk_mark_undone<S: NotificationIngress>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Json(req): Json<NotificationBulkRequest>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    todo!()
}
