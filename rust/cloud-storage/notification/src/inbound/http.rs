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
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{models::Notification, service::NotificationIngress};

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

pub fn router<S: NotificationIngress, T>(state: NotificationRouterState<S>) -> Router<T> {
    Router::new()
        .route("/", get(list_user_notifications))
        .route("/bulk/seen", patch(bulk_mark_seen))
        .route("/bulk/done", patch(bulk_mark_done))
        .route("/bulk/undone", patch(bulk_mark_undone))
        .with_state(state)
}

#[derive(serde::Deserialize)]
pub struct Params {
    pub limit: Option<u32>,
}

type TimestampOption = Option<chrono::DateTime<chrono::Utc>>;

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTemporalData {
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = false)]
    pub created_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub updated_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub deleted_at: TimestampOption,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(ToSchema))]
pub struct UserNotification<T> {
    /// The id of the notification. Self-generated uuidv7
    pub id: Uuid,
    #[serde(flatten)]
    pub notification_entity: Entity<'static>,
    /// If the notification has been sent
    pub sent: bool,
    /// If the notification is "done"
    pub done: bool,
    /// user id of the macro user who generated the notification
    #[cfg_attr(feature = "schema", schema(value_type = Option<String>))]
    pub sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub temporal: NotificationTemporalData,
    #[serde(flatten)]
    pub notification_event: T,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetAllUserNotificationsResponse<T> {
    pub items: Vec<UserNotification<T>>,
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
async fn list_user_notifications<S: NotificationIngress, T: Notification>(
    State(service): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Query(Params { limit }): Query<Params>,
    cursor: CursorExtractor<Uuid, CreatedAt, ()>,
) -> Result<Json<GetAllUserNotificationsResponse<T>>, (StatusCode, Json<ErrorResponse<'static>>)> {
    todo!()
}
