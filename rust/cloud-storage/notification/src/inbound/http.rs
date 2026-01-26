//! HTTP handlers for notification endpoints.
//!
//! These handlers expose the notification service via HTTP for internal
//! service-to-service communication.

use std::sync::Arc;

use rootcause::Report;

use crate::domain::models::{
    Notification, NotificationResult, RevokeCriteria, SendNotificationRequest,
};
use crate::domain::ports::{
    EmailSender, NotificationRepository, NotificationSender, RateLimitPort, WebSocketSender,
};
use crate::domain::service::{NotificationService, SendNotificationError};

/// Client for sending notifications.
///
/// This is the main entry point for other services to send notifications.
/// It wraps the `NotificationService` and provides a convenient API.
pub struct NotificationClient<R, N, W, M, E> {
    service: Arc<NotificationService<R, N, W, M, E>>,
}

impl<R, N, W, M, E> Clone for NotificationClient<R, N, W, M, E> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

impl<R, N, W, M, E> NotificationClient<R, N, W, M, E>
where
    R: RateLimitPort + Send + Sync,
    N: NotificationRepository + Send + Sync,
    W: WebSocketSender + Send + Sync,
    M: NotificationSender + Send + Sync,
    E: EmailSender + Send + Sync,
{
    /// Create a new notification client.
    pub fn new(service: NotificationService<R, N, W, M, E>) -> Self {
        Self {
            service: Arc::new(service),
        }
    }

    /// Send a notification to the specified recipients.
    ///
    /// This method performs all pre-queue checks (rate limiting, recipient filtering)
    /// before persisting the notification and delivering it via appropriate channels.
    ///
    /// Rate limiting is configured by the notification type via the `Notification` trait's
    /// `rate_limit_config()` and `rate_limit_key()` methods.
    ///
    /// # Arguments
    ///
    /// * `request` - The notification request containing recipients and content
    ///
    /// # Returns
    ///
    /// Returns the notification result including the ID and delivery status,
    /// or an error if rate limited or if delivery fails.
    pub async fn send<'a, T: Notification + Send + Sync>(
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
