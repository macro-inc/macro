//! Notification service implementation for properties.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{
    Notification, RateLimitConfig, RateLimitKey, SendNotificationRequestBuilder,
};
use notification::domain::service::NotificationIngress;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ports::NotificationService;

/// Notification sent when a user is assigned to a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignedNotification {
    /// The unique identifier of the task.
    pub task_id: String,
    /// The name of the task (optional).
    pub task_name: Option<String>,
    /// The user who assigned the task.
    pub assigned_by: MacroUserIdStr<'static>,
}

impl Notification for TaskAssignedNotification {
    const TYPE_NAME: &'static str = "task_assigned";

    fn title(&self) -> String {
        "Task Assigned".to_string()
    }

    fn body(&self) -> String {
        match &self.task_name {
            Some(name) => format!("You've been assigned to task: {}", name),
            None => "You've been assigned to a task".to_string(),
        }
    }

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

/// Notification service implementation using the new notification client.
pub struct NotificationServiceImpl<T> {
    notification_client: T,
}

impl<T> NotificationServiceImpl<T>
where
    T: NotificationIngress,
{
    /// Create a new notification service with the notification client.
    pub fn new(notification_client: T) -> Self {
        Self {
            notification_client,
        }
    }
}

impl<T> NotificationService for NotificationServiceImpl<T>
where
    T: NotificationIngress,
{
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn send_notification(
        &self,
        message: model_notifications::NotificationQueueMessage,
    ) -> Result<Uuid, Self::Err> {
        // Convert the old NotificationQueueMessage to the new format
        let notification_event = &message.notification_event;

        // Only handle TaskAssigned notifications for now
        match notification_event {
            model_notifications::NotificationEvent::TaskAssigned(metadata) => {
                let notification = TaskAssignedNotification {
                    task_id: metadata.task_id.clone(),
                    task_name: metadata.task_name.clone(),
                    assigned_by: metadata.assigned_by.clone(),
                };

                let recipient_strs = message.recipient_ids.unwrap_or_default();
                let recipient_ids: HashSet<MacroUserIdStr<'_>> = recipient_strs
                    .iter()
                    .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
                    .collect();

                if recipient_ids.is_empty() {
                    return Ok(Uuid::now_v7());
                }

                let request = SendNotificationRequestBuilder {
                    notification_entity: message.notification_entity.clone(),
                    notification,
                    sender_id: message.sender_id.clone(),
                    recipient_ids,
                }
                .into_request()
                .with_conn_gateway();

                let result = self
                    .notification_client
                    .send_notification(request)
                    .await
                    .map_err(|e| anyhow::anyhow!("failed to send notification: {}", e))?;

                Ok(result
                    .map(|r| r.notification_id)
                    .unwrap_or_else(Uuid::now_v7))
            }
            _ => {
                // For other notification types, log and return success
                // These should be migrated to specific handlers
                tracing::warn!(
                    event_type = ?notification_event.event_type(),
                    "unsupported notification type in properties service"
                );
                Ok(Uuid::now_v7())
            }
        }
    }
}
