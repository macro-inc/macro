//! HTTP handlers for notification endpoints.
//!
//! These handlers expose the notification service via HTTP for internal
//! service-to-service communication.

use std::sync::Arc;

use rootcause::Report;
use serde::Serialize;

use crate::domain::models::{
    Notification, NotificationResult, RevokeCriteria, SendNotificationRequest,
};
use crate::domain::ports::{NotificationQueue, NotificationRepository};
use crate::domain::service::{NotificationIngressService, SendNotificationError};

/// Client for sending notifications.
///
/// This is the main entry point for other services to send notifications.
/// It wraps the `NotificationIngressService` and provides a convenient API.
pub struct NotificationClient<N, Q> {
    service: Arc<NotificationIngressService<N, Q>>,
}

impl<N, Q> Clone for NotificationClient<N, Q> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

impl<N, Q> NotificationClient<N, Q>
where
    N: NotificationRepository + Send + Sync,
    Q: NotificationQueue + Send + Sync,
{
    /// Create a new notification client.
    pub fn new(service: NotificationIngressService<N, Q>) -> Self {
        Self {
            service: Arc::new(service),
        }
    }

    /// Send a notification to the specified recipients.
    ///
    /// This method performs recipient filtering before persisting the notification
    /// and publishing it to the queue for async delivery.
    ///
    /// # Arguments
    ///
    /// * `request` - The notification request containing recipients and content
    ///
    /// # Returns
    ///
    /// Returns the notification result including the ID and notified recipients,
    /// or an error if delivery fails.
    pub async fn send<'a, T: Notification + Serialize + Clone + Send + Sync>(
        &self,
        request: SendNotificationRequest<'a, T>,
    ) -> Result<NotificationResult, Report<SendNotificationError>> {
        self.service.send_notification(request).await
    }

    /// Revoke/delete notifications matching the given criteria.
    ///
    /// At least one filter must be set in the criteria.
    ///
    /// # Returns
    ///
    /// Returns the number of notifications deleted.
    pub async fn revoke<'a>(&self, criteria: RevokeCriteria<'a>) -> Result<u64, Report> {
        self.service.revoke_notifications(criteria).await
    }
}
