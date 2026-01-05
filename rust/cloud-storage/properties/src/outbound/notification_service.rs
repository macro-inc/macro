//! Notification service implementation for properties.

use uuid::Uuid;

use crate::domain::ports::NotificationService;

/// Notification service implementation using macro_notify client.
pub struct NotificationServiceImpl {
    notification_client: std::sync::Arc<macro_notify::MacroNotifyClient>,
}

impl NotificationServiceImpl {
    pub fn new(notification_client: std::sync::Arc<macro_notify::MacroNotifyClient>) -> Self {
        Self {
            notification_client,
        }
    }
}

impl NotificationService for NotificationServiceImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn send_notification(
        &self,
        message: model_notifications::NotificationQueueMessage,
    ) -> Result<Uuid, Self::Err> {
        self.notification_client.send_notification(message).await
    }
}
