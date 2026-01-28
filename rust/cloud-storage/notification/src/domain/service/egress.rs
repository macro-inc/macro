//! Egress service for delivering notifications.
//!
//! This service handles the worker-facing side of notifications:
//! consuming from the queue and delivering via WebSocket, push, and email.

use crate::domain::models::queue_message::{
    ConnGatewayNotification, DeliveryFailure, DeliverySuccess, EmailNotification, Node,
    NotificationChannel, QueueMessage,
};
use crate::domain::ports::{
    EmailSender, NotificationRepository, NotificationSender, RateLimitPort, WebSocketSender,
};
use rootcause::prelude::ResultExt;
use rootcause::{Report, report};

/// Service for delivering notifications (egress side).
///
/// Handles consuming from queue and delivering via WebSocket, push, and email.
pub struct NotificationEgressService<N, W, M, E, R> {
    #[allow(dead_code)]
    repository: N,
    websocket: W,
    mobile: M,
    email: E,
    rate_limiter: R,
}

impl<N, W, M, E, R> NotificationEgressService<N, W, M, E, R>
where
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
{
    /// Create a new egress service.
    pub fn new(repository: N, websocket: W, mobile: M, email: E, rate_limiter: R) -> Self {
        Self {
            repository,
            websocket,
            mobile,
            email,
            rate_limiter,
        }
    }

    /// Deliver a notification from a queue message.
    ///
    /// Processes the delivery chain, attempting each channel and falling back
    /// on failure. Returns a list of results for each delivery attempt.
    ///
    /// If a rate limit is configured and exceeded, returns an empty list (no delivery).
    pub async fn deliver_notification(
        &self,
        message: QueueMessage<'static, serde_json::Value>,
    ) -> Vec<Result<DeliverySuccess, Report<DeliveryFailure>>> {
        // Check rate limit if configured
        if let Some((key, config)) = message.rate_limit {
            match self.rate_limiter.check_and_increment(key, config).await {
                Ok(crate::domain::models::RateLimitResult::Exceeded(exceeded)) => {
                    return vec![Err(report!(exceeded).context(DeliveryFailure::RateLimit))];
                }
                Err(e) => return vec![Err(e.context(DeliveryFailure::RateLimit))],
                Ok(_) => {
                    // Rate limit allowed, continue
                }
            }
        }

        self.deliver_notification_inner(&message.message_type, message.content, Vec::new())
            .await
            .into_iter()
            .map(|r| r.context(DeliveryFailure::Other))
            .collect()
    }

    /// Deliver a single node, with fallback on failure.
    async fn deliver_notification_inner(
        &self,
        message_type: &str,
        node: Node<'static, serde_json::Value>,
        mut recursion_tail: Vec<Result<DeliverySuccess, Report>>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        let result = match &node.notif {
            NotificationChannel::ConnGateway(conn) => {
                self.deliver_conn_gateway(message_type, conn).await
            }
            NotificationChannel::Ios(apns) => self.deliver_ios(apns).await,
            NotificationChannel::Email(email) => self.deliver_email(email).await,
        };
        recursion_tail.push(result);
        let res = recursion_tail
            .last()
            .expect("we just pushed, this cannot fail");

        match (res, node.on_failure) {
            (Ok(_), _) | (Err(_), None) => recursion_tail,
            (Err(_), Some(fallback)) => {
                Box::pin(self.deliver_notification_inner(message_type, *fallback, recursion_tail))
                    .await
            }
        }
    }

    /// Deliver via connection gateway (WebSocket).
    async fn deliver_conn_gateway(
        &self,
        message_type: &str,
        conn: &ConnGatewayNotification<'static, serde_json::Value>,
    ) -> Result<DeliverySuccess, Report> {
        let notifications: Vec<_> = conn
            .recipients
            .iter()
            .map(|r| (r.clone(), &conn.notif))
            .collect();

        self.websocket
            .send_notifications(message_type, notifications)
            .await?;
        Ok(DeliverySuccess::ConnGateway)
    }

    /// Deliver via iOS push (APNS).
    async fn deliver_ios(
        &self,
        apns: &crate::domain::models::queue_message::APNSTargets<serde_json::Value>,
    ) -> Result<DeliverySuccess, Report> {
        for endpoint in &apns.ios_device_endpoints {
            self.mobile
                .send_ios_push_notification(endpoint, &apns.notif, &apns.attributes)
                .await?;
        }
        Ok(DeliverySuccess::Ios)
    }

    /// Deliver via email.
    async fn deliver_email(
        &self,
        email: &EmailNotification<'static>,
    ) -> Result<DeliverySuccess, Report> {
        self.email
            .send_email(email.to.clone(), &email.content)
            .await?;
        Ok(DeliverySuccess::Email)
    }
}
