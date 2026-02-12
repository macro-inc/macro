//! Egress service for delivering notifications.
//!
//! This service handles the worker-facing side of notifications:
//! consuming from the queue and delivering via WebSocket, push, and email.

use crate::domain::models::RateLimitResult;
use crate::domain::models::queue_message::{
    ConnGatewayNotification, DeliveryFailure, DeliverySuccess, EmailNotification, Node,
    NotificationChannel, QueueMessage,
};
use crate::domain::ports::{
    EmailSender, NotificationEgress, NotificationQueue, NotificationRepository, NotificationSender,
    RateLimitPort, WebSocketSender,
};
use either::Either;
use rootcause::prelude::ResultExt;
use rootcause::{Report, report};

/// Service for delivering notifications (egress side).
///
/// Handles consuming from queue and delivering via WebSocket, push, and email.
pub struct NotificationEgressService<Q, N, W, M, E, R> {
    queue: Q,
    #[allow(dead_code)]
    repository: N,
    websocket: W,
    mobile: M,
    email: E,
    rate_limiter: R,
}

impl<Q, N, W, M, E, R> NotificationEgressService<Q, N, W, M, E, R>
where
    Q: NotificationQueue,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
{
    /// Create a new egress service.
    pub fn new(
        queue: Q,
        repository: N,
        websocket: W,
        mobile: M,
        email: E,
        rate_limiter: R,
    ) -> Self {
        Self {
            queue,
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
        message: QueueMessage<'static, serde_json::Value, serde_json::Value>,
    ) -> Vec<Result<DeliverySuccess, Report<DeliveryFailure>>> {
        // Check rate limit if configured
        if let Some((key, config)) = message.rate_limit {
            match self.rate_limiter.check_and_increment(key, config).await {
                Ok(RateLimitResult::Exceeded(exceeded)) => {
                    return vec![Err(report!(exceeded).context(DeliveryFailure::RateLimit))];
                }
                Ok(RateLimitResult::Allowed { .. }) => {
                    // Rate limit allowed, continue
                }
                Err(e) => return vec![Err(e.context(DeliveryFailure::Other))],
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
        node: Node<'static, serde_json::Value, serde_json::Value>,
        mut recursion_tail: Vec<Result<DeliverySuccess, Report>>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        let result = match &node.notif {
            NotificationChannel::ConnGateway(conn) => {
                Either::Left([self.deliver_conn_gateway(conn).await])
            }
            NotificationChannel::Email(email) => Either::Left([self.deliver_email(email).await]),
            NotificationChannel::Ios(apns) => Either::Right(self.deliver_ios(apns).await),
        };
        let all_failed = result.iter().all(Result::is_err);
        recursion_tail.extend(result.into_iter());

        match (all_failed, node.on_failure) {
            (false, _) | (true, None) => recursion_tail,
            (true, Some(fallback)) => {
                Box::pin(self.deliver_notification_inner(message_type, *fallback, recursion_tail))
                    .await
            }
        }
    }

    /// Deliver via connection gateway (WebSocket).
    async fn deliver_conn_gateway(
        &self,
        conn: &ConnGatewayNotification<'static, serde_json::Value>,
    ) -> Result<DeliverySuccess, Report> {
        self.websocket
            .send_notifications(&conn.recipients, &conn.notif)
            .await?;
        Ok(DeliverySuccess::ConnGateway)
    }

    /// Deliver via iOS push (APNS).
    async fn deliver_ios(
        &self,
        apns: &crate::domain::models::queue_message::APNSTargets<serde_json::Value>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        let mut out = Vec::with_capacity(apns.ios_device_endpoints.len());
        for endpoint in &apns.ios_device_endpoints {
            let res = self
                .mobile
                .send_ios_push_notification(endpoint, &apns.notif, &apns.attributes)
                .await
                .map(|()| DeliverySuccess::Ios);
            out.push(res)
        }
        out
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

impl<Q, N, W, M, E, R> NotificationEgress for NotificationEgressService<Q, N, W, M, E, R>
where
    Q: NotificationQueue,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
{
    #[tracing::instrument(ret, skip(self))]
    async fn poll_and_deliver(&self) -> Vec<Result<DeliverySuccess, Report>> {
        let messages = match self.queue.receive_messages().await {
            Ok(msgs) => msgs,
            Err(e) => {
                return vec![Err(e)];
            }
        };

        let mut results = Vec::new();

        for message in messages {
            let receipt_handle = message.receipt_handle.clone();

            // Deliver the notification (body is already parsed as QueueMessage)
            let delivery_results = self.deliver_notification(message.body).await;

            // Check if any deliveries succeeded
            let any_succeeded = delivery_results.iter().any(Result::is_ok);

            // Add results (stripping the DeliveryFailure context for the trait return type)
            for result in delivery_results {
                results.push(result.map_err(Report::from));
            }

            // Delete from queue if any deliveries succeeded
            if any_succeeded && let Err(e) = self.queue.delete_message(&receipt_handle).await {
                // if delete queue fails push it into the results
                results.push(Err(e))
            }
        }

        results
    }
}
