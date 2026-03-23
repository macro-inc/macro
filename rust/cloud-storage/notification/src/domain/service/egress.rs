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
use crate::domain::models::{NotificationExtEmail, NotificationTypeName, RateLimitResult};
use crate::domain::ports::{
    EmailSender, NotificationEgress, NotificationQueue, NotificationRepository, NotificationSender,
    RateLimitService, WebSocketSender,
};
use either::Either;
use futures::stream::{FuturesUnordered, StreamExt};
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::ResultExt;
use rootcause::{Report, report};
use std::time::Duration;
use tracing::Level;

/// Maximum time to wait for a single notification delivery before timing out.
pub(crate) const DELIVERY_TIMEOUT: Duration = Duration::from_secs(15);

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
    R: RateLimitService,
    S: BulkDigestEgressStateMachine,
    D: DigestBatcher,
{
    /// Deliver a notification from a queue message.
    ///
    /// Processes the delivery chain, attempting each channel and falling back
    /// on failure. Returns a list of results for each delivery attempt.
    ///
    /// If a rate limit is configured and exceeded, returns an empty list (no delivery).
    #[tracing::instrument(ret, level = Level::INFO, skip(self))]
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
            NotificationChannel::Email(email) => Either::Left([self.deliver_email(email).await]),
            NotificationChannel::Ios(apns) => Either::Right(
                self.deliver_ios(&apns)
                    .await
                    .into_iter()
                    .map(|r| r.context(DeliveryFailure::Ios)),
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
        email: EmailNotification<'static>,
    ) -> Result<DeliverySuccess, Report<DeliveryFailure>> {
        let EmailNotification {
            content,
            to: recipient,
            rate_limit_config,
            rate_limit_key,
        } = email;

        let ticket = self
            .rate_limiter
            .check_rate_limit(rate_limit_key, rate_limit_config)
            .await
            .context(DeliveryFailure::Other)?;

        match &*ticket {
            RateLimitResult::Exceeded(exceeded) => {
                return Err(report!(
                    "Rate limit key: {} was exceeded. Current count is {} but max count is {}",
                    exceeded.key,
                    exceeded.current_count,
                    exceeded.max_count
                )
                .context(DeliveryFailure::RateLimit(exceeded.clone())));
            }
            RateLimitResult::Allowed { .. } => {}
        }

        self.email
            .send_email(recipient.clone(), &content)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    recipient = %recipient,
                    subject = %content.subject,
                    "Email delivery failed"
                );
            })
            .context(DeliveryFailure::Other)?;

        self.rate_limiter
            .increment_ticket(ticket)
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
    R: RateLimitService,
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

        // Deliver all messages concurrently
        let delivery_futures: FuturesUnordered<_> = messages
            .into_iter()
            .map(async |message| {
                let receipt_handle = message.receipt_handle;
                let delivery_results = match tokio::time::timeout(
                    DELIVERY_TIMEOUT,
                    self.deliver_notification(message.body),
                )
                .await
                {
                    Ok(x) => x,
                    Err(_) => {
                        tracing::warn!("Notification egress task timed out");
                        vec![Err(report!(DeliveryFailure::Timeout))]
                    }
                };
                (receipt_handle, delivery_results)
            })
            .collect();

        let outcomes: Vec<_> = delivery_futures.collect().await;

        for (receipt_handle, delivery_results) in outcomes {
            let any_succeeded = delivery_results.iter().any(Result::is_ok);
            let all_ios_failed = delivery_results.iter().all(
                |e| matches!(e, Err(e) if matches!(e.current_context(), DeliveryFailure::Ios )),
            );
            let rate_limited = delivery_results.iter().find_map(|e| {
                match e.as_ref().map_err(Report::current_context) {
                    Err(DeliveryFailure::RateLimit(rate_limit)) => Some(rate_limit),
                    Ok(_)
                    | Err(
                        DeliveryFailure::Ios | DeliveryFailure::Other | DeliveryFailure::Timeout,
                    ) => None,
                }
            });

            // Delete from queue if any deliveries succeeded
            // or all the failed notifs were ios
            if (any_succeeded || all_ios_failed)
                && let Err(e) = self.queue.delete_message(&receipt_handle).await
            {
                // push the failed delete to errors
                results.push(Err(e))
            } else if let Some(rate_limited) = rate_limited
                && let Err(e) = self
                    .queue
                    // if we got rate limited, delay this message by the rate limit expiry time
                    .delay_message(&receipt_handle, rate_limited.retry_after)
                    .await
            {
                // push the failed delay to errors
                results.push(Err(e))
            }

            for result in delivery_results {
                results.push(result.map_err(Report::from));
            }
        }

        results
    }

    // #[tracing::instrument(err, skip(self))]
    async fn poll_email_digests<T: NotificationExtEmail>(
        &self,
        f: fn(DigestBatch) -> Result<T, Report>,
    ) -> Result<ClaimResult<()>, Report> {
        let batch =
            match tokio::time::timeout(DELIVERY_TIMEOUT, self.digest_batcher.claim_ready_digest())
                .await
                .context("Dequeing redis batch exceeded timeout")??
            {
                ClaimResult::Ready(batch) => batch,
                v @ ClaimResult::Empty | v @ ClaimResult::Wait(_) => return Ok(v.map(|_| ())),
            };

        if batch.user_id.email_part().domain_part() != "macro.com" {
            return Err(report!(
                "Sending digest for non-macro user is currently disabled"
            ));
        }

        let recipient: MacroUserIdStr<'static> = batch.user_id.clone();
        let email_notif = f(batch)?;
        let email_content = EmailCreateBundle::new(&email_notif).with_recipient(recipient);

        let typename = NotificationTypeName::new_from_notif(&email_notif);

        let message: QueueMessage<'static, T, ()> =
            QueueMessage::new_from_email(email_content, &typename);

        self.queue.publish(vec![message]).await?;

        Ok(ClaimResult::Ready(()))
    }
}
