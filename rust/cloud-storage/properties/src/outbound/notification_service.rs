//! Notification service implementation for properties.

use std::collections::HashSet;

use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use model_entity::Entity;
use notification::domain::models::{
    Notification, NotifCollapseKey, NotificationExtIos, RateLimitConfig, RateLimitKey,
    SendNotificationRequestBuilder,
    apple::{APNSPushNotification, AlertDictionary, Aps},
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

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl NotificationExtIos for TaskAssignedNotification {
    type NotifData = ();

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        _sender_id: Option<MacroUserIdStr<'a>>,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let title = self.assigned_by.email_part().email_str().to_string();
        let body = if let Some(ref task_name) = self.task_name {
            format!("assigned you to {}", task_name)
        } else {
            "assigned you a task".to_string()
        };
        Some(APNSPushNotification {
            aps: Aps {
                alert: Some(notification::domain::models::apple::Alert::Dictionary(
                    AlertDictionary {
                        title: Some(title),
                        body: Some(body),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            },
            push_notification_data: (),
        })
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
                .with_apns()
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
