//! Notification service implementation for properties.

use crate::domain::ports::NotificationService;
use model_notifications::TaskAssignedMetadata;
use notification::domain::models::SendNotificationRequest;
use notification::domain::service::NotificationIngress;
use uuid::Uuid;

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

    #[tracing::instrument(skip(self, message), err)]
    async fn send_notification(
        &self,
        message: SendNotificationRequest<'_, TaskAssignedMetadata, ()>,
    ) -> Result<Uuid, Self::Err> {
        let result = self
            .notification_client
            .send_notification(message)
            .await
            .map_err(|e| anyhow::anyhow!("failed to send notification: {}", e))?;

        Ok(result
            .map(|r| r.notification_id)
            .unwrap_or_else(Uuid::now_v7))
    }
}
