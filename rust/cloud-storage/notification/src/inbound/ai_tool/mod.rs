//! This module provides the inbound adapter for ai tools using the notifications service

#[cfg(test)]
mod test;

use crate::domain::{
    models::{
        UserNotificationRow,
        request::{NotificationStatus, UpdateNotificationsRequest},
    },
    service::NotificationReader,
};
use ai::tool::{
    AsyncTool, AsyncToolSet, RequestContext, ServiceContext, ToolCallError, ToolResult,
};
use async_trait::async_trait;
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::CreatedAt;
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Service context for notification AI tools
pub struct NotificationToolContext<T> {
    /// The notification service instance
    pub service: Arc<T>,
}

impl<T> Clone for NotificationToolContext<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

impl<T: NotificationReader> NotificationToolContext<T> {
    /// Create a new notification tool context
    pub fn new(service: T) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Create a notification toolset for AI agents
pub fn notification_toolset<T>() -> AsyncToolSet<NotificationToolContext<T>>
where
    T: NotificationReader,
{
    AsyncToolSet::new()
        .add_tool::<ListNotifications, NotificationToolContext<T>>()
        .add_tool::<MarkNotificationsSeen, NotificationToolContext<T>>()
        .add_tool::<MarkNotificationsDone, NotificationToolContext<T>>()
}

/// List the current user's active notifications.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListNotifications",
    description = "List the current user's active (not deleted, not done) notifications. Returns notifications ordered by most recent first. Use this to show the user their unread or pending notifications."
)]
pub struct ListNotifications {
    /// Maximum number of notifications to return. Defaults to 20, max 50.
    #[schemars(description = "Maximum number of notifications to return. Defaults to 20, max 50.")]
    pub limit: Option<u32>,
}

/// A single notification item in the list response.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    /// The notification ID.
    pub id: Uuid,
    /// The notification event type (e.g. "channel_mention").
    pub event_type: String,
    /// The type of entity this notification is about (e.g. "channel", "document").
    pub entity_type: String,
    /// The ID of the entity this notification is about.
    pub entity_id: String,
    /// Whether the notification has been seen.
    pub seen: bool,
    /// Whether the notification is marked as done.
    pub done: bool,
    /// When the notification was created (ISO 8601).
    pub created_at: String,
    /// The notification metadata/payload.
    pub metadata: serde_json::Value,
    /// The user ID of the sender, if any.
    pub sender_id: Option<String>,
}

impl From<UserNotificationRow<serde_json::Value>> for NotificationItem {
    fn from(row: UserNotificationRow<serde_json::Value>) -> Self {
        Self {
            id: row.notification_id,
            event_type: row.notification_event_type,
            entity_type: row.entity.entity_type.to_string(),
            entity_id: row.entity.entity_id.into_owned(),
            seen: row.viewed_at.is_some(),
            done: row.done,
            created_at: row.created_at.to_rfc3339(),
            metadata: row.notification_metadata,
            sender_id: row.sender_id.map(|s| (*s).as_ref().to_owned()),
        }
    }
}

/// Response from listing notifications.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListNotificationsResponse {
    /// The list of notifications.
    pub notifications: Vec<NotificationItem>,
    /// Whether there are more notifications available.
    pub has_more: bool,
}

#[async_trait]
impl<T> AsyncTool<NotificationToolContext<T>> for ListNotifications
where
    T: NotificationReader,
{
    type Output = ListNotificationsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, limit=?self.limit), err)]
    async fn call(
        &self,
        service_context: ServiceContext<NotificationToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let limit = self.limit.unwrap_or(20).min(50);

        tracing::info!("Listing notifications");

        let paginated = service_context
            .service
            .get_user_notifications::<serde_json::Value>(
                MacroUserIdStr((*request_context.user_id).copied()),
                Some(limit),
                models_pagination::Query::Sort(CreatedAt, ()),
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list notifications: {e}"),
                internal_error: anyhow::Error::from_boxed(e.into_boxed_error()),
            })?;

        let has_more = paginated.next_cursor.is_some();
        let notifications = paginated
            .items
            .into_iter()
            .map(NotificationItem::from)
            .collect();

        Ok(ListNotificationsResponse {
            notifications,
            has_more,
        })
    }
}

/// Response from marking notifications as seen or done.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsResponse {
    /// Whether the operation succeeded.
    pub success: bool,
    /// The number of notifications updated.
    pub count: usize,
}

/// Mark one or more notifications as seen for the current user.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MarkNotificationsSeen",
    description = "Mark one or more notifications as seen for the current user. Use this when the user has viewed notifications but hasn't acted on them yet."
)]
pub struct MarkNotificationsSeen {
    /// The IDs of the notifications to mark as seen.
    #[schemars(description = "The IDs of the notifications to mark as seen.")]
    pub notification_ids: Vec<Uuid>,
}

#[async_trait]
impl<T> AsyncTool<NotificationToolContext<T>> for MarkNotificationsSeen
where
    T: NotificationReader,
{
    type Output = MarkNotificationsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, count=self.notification_ids.len()), err)]
    async fn call(
        &self,
        service_context: ServiceContext<NotificationToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(notification_ids=?self.notification_ids, "Marking notifications as seen");

        let count = self.notification_ids.len();

        service_context
            .service
            .update_notifications(UpdateNotificationsRequest {
                user_id: MacroUserIdStr((*request_context.user_id).clone()),
                notification_ids: &self.notification_ids,
                status: NotificationStatus::Seen,
            })
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to mark notifications as seen: {e}"),
                internal_error: anyhow::Error::from_boxed(e.into_boxed_error()),
            })?;

        Ok(MarkNotificationsResponse {
            success: true,
            count,
        })
    }
}

/// Mark one or more notifications as done or not done for the current user.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MarkNotificationsDone",
    description = "Mark one or more notifications as done or not done for the current user. Use this when the user has completed the action associated with a notification."
)]
pub struct MarkNotificationsDone {
    /// The IDs of the notifications to update.
    #[schemars(description = "The IDs of the notifications to update.")]
    pub notification_ids: Vec<Uuid>,

    /// Whether to mark as done (true) or not done (false). Defaults to true.
    #[schemars(description = "Whether to mark as done (true) or not done (false).")]
    pub done: bool,
}

#[async_trait]
impl<T> AsyncTool<NotificationToolContext<T>> for MarkNotificationsDone
where
    T: NotificationReader,
{
    type Output = MarkNotificationsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, count=self.notification_ids.len(), done=self.done), err)]
    async fn call(
        &self,
        service_context: ServiceContext<NotificationToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(notification_ids=?self.notification_ids, done=self.done, "Marking notifications as done/undone");

        let count = self.notification_ids.len();

        service_context
            .service
            .update_notifications(UpdateNotificationsRequest {
                user_id: MacroUserIdStr((*request_context.user_id).clone()),
                notification_ids: &self.notification_ids,
                status: NotificationStatus::Done(self.done),
            })
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to mark notifications as done: {e}"),
                internal_error: anyhow::Error::from_boxed(e.into_boxed_error()),
            })?;

        Ok(MarkNotificationsResponse {
            success: true,
            count,
        })
    }
}
