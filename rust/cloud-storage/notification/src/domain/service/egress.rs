//! Egress service for delivering notifications.
//!
//! This service handles the worker-facing side of notifications:
//! consuming from the queue and delivering via WebSocket, push, and email.

use crate::domain::models::apple::APNSPushNotification;
use crate::domain::models::email_notification_digest::ports::{
    ClaimResult, DigestBatch, DigestBatcher, MessageId, NotificationSendChecker,
};
use crate::domain::models::email_notification_digest::{
    BulkDigestEgressStateMachine, ResumeMachineBRequest,
};
use crate::domain::models::mobile::MessageAttributes;
use crate::domain::models::queue_message::{
    APNSTargets, ConnGatewayNotification, DeliveryFailure, DeliverySuccess, EmailCreateBundle,
    EmailNotification, NotificationChannel, QueueMessage,
};
use crate::domain::models::{NotificationExtEmail, RateLimitResult};
use crate::domain::ports::{
    EmailSender, NotificationEgress, NotificationQueue, NotificationRepository, NotificationSender,
    RateLimitPort, WebSocketSender,
};
use either::Either;
use rootcause::prelude::ResultExt;
use rootcause::{Report, report};

/// Wraps a single iOS push notification send for the bulk-digest state machine.
///
/// The state machine calls [`NotificationSendChecker::send_notification`] to perform the actual
/// push delivery, then records the SNS message ID or queues for batch email on failure.
struct IosPushSend<'a, M> {
    mobile: &'a M,
    endpoint_arn: &'a str,
    notif: &'a APNSPushNotification<serde_json::Value>,
    attributes: &'a MessageAttributes,
}

impl<M: NotificationSender> NotificationSendChecker for IosPushSend<'_, M> {
    type Ok = String;
    type Err = Report;

    async fn send_notification(self) -> Result<String, Report> {
        self.mobile
            .send_ios_push_notification(self.endpoint_arn, self.notif, self.attributes)
            .await
    }

    fn extract_message_id(res: &String) -> MessageId {
        MessageId(res.clone())
    }
}

/// Service for delivering notifications (egress side).
///
/// Handles consuming from queue and delivering via WebSocket, push, and email.
pub struct NotificationEgressService<Q, N, W, M, E, R, S, D> {
    /// Queue for receiving notification messages.
    pub queue: Q,
    /// Notification repository for DB operations.
    pub repository: N,
    /// WebSocket sender for real-time delivery.
    pub websocket: W,
    /// Mobile push sender (APNS/FCM).
    pub mobile: M,
    /// Email sender.
    pub email: E,
    /// Rate limiter.
    pub rate_limiter: R,
    /// Bulk digest egress state machine.
    pub state_machine: S,
    /// Digest batcher for claiming ready email digests.
    pub digest_batcher: D,
}

impl<Q, N, W, M, E, R, S, D> NotificationEgressService<Q, N, W, M, E, R, S, D>
where
    Q: NotificationQueue,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
    S: BulkDigestEgressStateMachine,
    D: DigestBatcher,
{
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
        let content = message.into_inner();

        let results = match content {
            NotificationChannel::ConnGateway(ref conn) => Either::Left([self
                .deliver_conn_gateway(conn)
                .await
                .context(DeliveryFailure::Other)]),
            NotificationChannel::Email(ref email) => {
                Either::Left([self.deliver_email(email).await])
            }
            NotificationChannel::Ios(apns) => Either::Right(
                self.deliver_ios(&apns)
                    .await
                    .into_iter()
                    .map(|r| r.context(DeliveryFailure::Other)),
            ),
        };

        results.into_iter().collect()
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
    ///
    /// Iterates per-user. If a user has a digest state machine entry, all
    /// endpoints are passed to [`BulkDigestEgressStateMachine::continue_machine`]
    /// in a single call. The state machine records SNS message IDs for successes
    /// and only queues a batch email if ALL endpoints fail.
    /// Users without a state machine entry are sent directly.
    async fn deliver_ios(
        &self,
        apns: &APNSTargets<serde_json::Value>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        let total: usize = apns
            .ios_device_endpoints
            .values()
            .map(|u| u.endpoints.len())
            .sum();
        let mut out = Vec::with_capacity(total);

        for user_apns in apns.ios_device_endpoints.values() {
            if let Some(ref entry) = user_apns.digest_state {
                // Build all send checkers for this user's endpoints
                let checkers: Vec<_> = user_apns
                    .endpoints
                    .iter()
                    .map(|endpoint| IosPushSend {
                        mobile: &self.mobile,
                        endpoint_arn: endpoint,
                        notif: &apns.notif,
                        attributes: &apns.attributes,
                    })
                    .collect();

                let req = ResumeMachineBRequest {
                    notification_enabled: entry.inner().clone(),
                    send_notifs: checkers,
                };

                let (results, batch_decision) = self.state_machine.continue_machine(req).await;

                if let Either::Right(Err(ref batch_err)) = batch_decision {
                    tracing::error!(error=?batch_err, "failed to queue digest batch after all pushes failed");
                }

                for result in results {
                    out.push(result.map(|_| DeliverySuccess::Ios));
                }
            } else {
                // No state machine entry — send directly
                for endpoint in &user_apns.endpoints {
                    let res = self
                        .mobile
                        .send_ios_push_notification(endpoint, &apns.notif, &apns.attributes)
                        .await
                        .map(|_| DeliverySuccess::Ios);
                    out.push(res);
                }
            }
        }

        out
    }

    /// Deliver via email.
    async fn deliver_email(
        &self,
        email: &EmailNotification<'static>,
    ) -> Result<DeliverySuccess, Report<DeliveryFailure>> {
        let (config, key) = email.rate_limit();

        match self.rate_limiter.check_and_increment(key, config).await {
            Ok(RateLimitResult::Exceeded(exceeded)) => {
                return Err(report!(exceeded).context(DeliveryFailure::RateLimit));
            }
            Ok(RateLimitResult::Allowed { .. }) => {
                // Rate limit allowed, continue
            }
            Err(e) => return Err(e.context(DeliveryFailure::Other)),
        }

        self.email
            .send_email(email.to().clone(), &email.content)
            .await
            .context(DeliveryFailure::Other)?;
        Ok(DeliverySuccess::Email)
    }
}

impl<Q, N, W, M, E, R, S, D> NotificationEgress
    for NotificationEgressService<Q, N, W, M, E, R, S, D>
where
    Q: NotificationQueue,
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
    R: RateLimitPort,
    S: BulkDigestEgressStateMachine,
    D: DigestBatcher,
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

    #[tracing::instrument(err, skip(self))]
    async fn poll_email_digests<T: NotificationExtEmail>(
        &self,
        f: fn(DigestBatch) -> Result<T, Report>,
    ) -> Result<ClaimResult<()>, Report> {
        let batch = match self.digest_batcher.claim_ready_digest().await? {
            ClaimResult::Ready(batch) => batch,
            v @ ClaimResult::Empty | v @ ClaimResult::Wait(_) => return Ok(v.map(|_| ())),
        };

        let recipient = batch.user_id.clone();
        let email_notif: T = f(batch)?;
        let email_content = EmailCreateBundle::new(&email_notif).with_recipient(recipient);

        let message: QueueMessage<'_, T, ()> =
            QueueMessage::new(NotificationChannel::Email(email_content));

        self.queue
            .publish(std::iter::once(message))
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to queue digest email");
            })?;

        Ok(ClaimResult::Ready(()))
    }
}
