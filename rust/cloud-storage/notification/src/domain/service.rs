//! Core notification service implementation.
//!
//! Contains two services:
//! - [`NotificationIngressService`]: For callers to send notifications (rate limit, filter, persist, publish to queue)
//! - [`NotificationEgressService`]: For workers to deliver notifications (consume from queue, deliver, update status)

#[cfg(test)]
mod test;

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::models::queue_message::{
    ConnGatewayNotification, DeliverySuccess, EmailNotification, Node, NotificationChannel,
    QueueMessage,
};
use crate::domain::models::{
    DeliveryStatus, ExclusionReason, FilteredRecipients, Notification, NotificationResult,
    RecipientExclusion, RevokeCriteria, SendNotificationRequest, SendNotificationRequestBuilder,
};
use crate::domain::ports::{
    EmailSender, NotificationQueue, NotificationRepository, NotificationSender, WebSocketSender,
};

/// Error returned when sending a notification fails.
#[derive(Debug, Error)]
pub enum SendNotificationError {
    /// Rate limit was exceeded.
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    /// Invalid rate limit config, either a key was provided but a key was not, or vice versa.
    #[error("Rate limit config error")]
    RateLimitConfigErr,
    /// An internal error occurred.
    #[error("Internal error")]
    Other,
}

/// Error returned when revoke criteria has no filters set.
#[derive(Debug, Error)]
#[error("At least one filter must be set to revoke notifications")]
pub struct MissingRevokeFilter;

// =============================================================================
// Ingress Service - For callers to send notifications
// =============================================================================

/// Service for sending notifications (ingress side).
///
/// Handles recipient filtering, DB persistence, and queue publishing.
/// Does NOT handle delivery - that's done by [`NotificationEgressService`].
pub struct NotificationIngressService<N, Q> {
    repository: N,
    queue: Q,
    service_name: String,
}

impl<N, Q> NotificationIngressService<N, Q>
where
    N: NotificationRepository,
    Q: NotificationQueue,
{
    /// Create a new ingress service.
    pub fn new(repository: N, queue: Q, service_name: impl Into<String>) -> Self {
        Self {
            repository,
            queue,
            service_name: service_name.into(),
        }
    }

    /// Send a notification to the specified recipients.
    ///
    /// This method performs the following steps:
    /// 1. Rate limit check (if a rate limit key is provided)
    /// 2. Filter recipients (remove sender, muted users, unsubscribed users)
    /// 3. Create notification in the database
    /// 4. Build and publish QueueMessage to SQS
    /// 5. Return result (delivery happens async via worker)
    pub async fn send_notification<'a, T: Notification + Serialize + Clone + Send + Sync>(
        &self,
        request: SendNotificationRequest<'a, T>,
    ) -> Result<NotificationResult, Report<SendNotificationError>> {
        let filtered = self
            .filter_recipients(
                request.req.sender_id.as_ref(),
                &request.req.recipient_ids,
                &request.req.notification_entity.entity_id,
            )
            .await
            .context(SendNotificationError::Other)?;

        if !filtered.has_valid_recipients() {
            // No valid recipients after filtering - return early with empty result
            return Ok(NotificationResult {
                notification_id: Uuid::now_v7(),
                notified_recipients: HashSet::new(),
            });
        }

        // 3. Create notification in DB
        let notification_id = Uuid::now_v7();
        let created = self
            .repository
            .create_notification(
                &request.req,
                notification_id,
                &self.service_name,
                &filtered.valid,
            )
            .await
            .context(SendNotificationError::Other)?;

        // If notification already exists (idempotent), return early
        let Some(notification_id) = created else {
            return Ok(NotificationResult {
                notification_id,
                notified_recipients: HashSet::new(),
            });
        };

        // 4. Build and publish QueueMessage
        let queue_message = self.build_queue_message(&request.req, &filtered.valid)?;

        self.queue
            .publish(&queue_message)
            .await
            .context(SendNotificationError::Other)?;

        // 5. Return result (delivery happens async)
        Ok(NotificationResult {
            notification_id,
            notified_recipients: filtered.valid_set_owned(),
        })
    }

    /// Revoke/delete notifications matching the given criteria.
    ///
    /// Returns the number of notifications deleted.
    pub async fn revoke_notifications<'a>(
        &self,
        criteria: RevokeCriteria<'a>,
    ) -> Result<u64, Report> {
        if !criteria.has_filter() {
            return Err(Report::new(MissingRevokeFilter).into());
        }

        self.repository.delete_notifications(&criteria).await
    }

    /// Filter recipients based on:
    /// - Sender (sender cannot receive their own notification)
    /// - Muted notifications
    /// - Unsubscribed from item
    async fn filter_recipients<'a>(
        &self,
        sender_id: Option<&MacroUserIdStr<'a>>,
        recipient_ids: &[MacroUserIdStr<'a>],
        item_id: &str,
    ) -> Result<FilteredRecipients<'a>, Report> {
        let mut valid: Vec<MacroUserIdStr<'a>> = Vec::new();
        let mut excluded: Vec<RecipientExclusion<'a>> = Vec::new();

        // First pass: remove sender
        for recipient in recipient_ids {
            if sender_id.is_some_and(|s| s == recipient) {
                excluded.push(RecipientExclusion {
                    user_id: recipient.clone(),
                    reason: ExclusionReason::IsSender,
                });
            } else {
                valid.push(recipient.clone());
            }
        }

        if valid.is_empty() {
            return Ok(FilteredRecipients { valid, excluded });
        }

        // Get muted users
        let muted_users = self.repository.get_muted_users(&valid).await?;

        // Get unsubscribed users
        let unsubscribed_users = self
            .repository
            .get_unsubscribed_users(item_id, &valid)
            .await?;

        // Second pass: filter muted and unsubscribed
        let mut final_valid = Vec::new();
        for recipient in valid {
            let recipient_static: MacroUserIdStr<'static> = recipient.clone().into_owned();

            if muted_users.contains(&recipient_static) {
                excluded.push(RecipientExclusion {
                    user_id: recipient,
                    reason: ExclusionReason::MutedNotifications,
                });
            } else if unsubscribed_users.contains(&recipient_static) {
                excluded.push(RecipientExclusion {
                    user_id: recipient,
                    reason: ExclusionReason::UnsubscribedFromItem,
                });
            } else {
                final_valid.push(recipient);
            }
        }

        Ok(FilteredRecipients {
            valid: final_valid,
            excluded,
        })
    }

    /// Build a QueueMessage with delivery nodes for the notification.
    fn build_queue_message<'a, T: Notification + Serialize + Clone>(
        &self,
        notification: &SendNotificationRequestBuilder<T>,
        recipients: &[MacroUserIdStr<'a>],
    ) -> Result<QueueMessage<'a, T>, Report<SendNotificationError>> {
        let rate_limit = notification.get_rate_limit()?;

        Ok(QueueMessage {
            message_type: T::TYPE_NAME.to_string(),
            rate_limit,
            content: Node {
                notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                    notif: notification.notification.clone(),
                    recipients: recipients.to_vec(),
                }),
                on_failure: None,
            },
        })
    }
}

// =============================================================================
// Egress Service - For workers to deliver notifications
// =============================================================================

/// Service for delivering notifications (egress side).
///
/// Handles consuming from queue and delivering via WebSocket, push, and email.
pub struct NotificationEgressService<N, W, M, E> {
    repository: N,
    websocket: W,
    mobile: M,
    email: E,
}

impl<N, W, M, E> NotificationEgressService<N, W, M, E>
where
    N: NotificationRepository,
    W: WebSocketSender,
    M: NotificationSender,
    E: EmailSender,
{
    /// Create a new egress service.
    pub fn new(repository: N, websocket: W, mobile: M, email: E) -> Self {
        Self {
            repository,
            websocket,
            mobile,
            email,
        }
    }

    pub async fn deliver_notification(
        &self,
        message: QueueMessage<'static, serde_json::Value>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        // TODO handle the rate limit

        self.deliver_notification_inner(&message.message_type, message.content, Vec::new())
            .await
    }

    /// Deliver a single node, with fallback on failure.
    async fn deliver_notification_inner(
        &self,
        message_type: &str,
        node: Node<'static, serde_json::Value>,
        mut recusion_tail: Vec<Result<DeliverySuccess, Report>>,
    ) -> Vec<Result<DeliverySuccess, Report>> {
        let mut status = DeliveryStatus::default();

        let result = match &node.notif {
            NotificationChannel::ConnGateway(conn) => {
                self.deliver_conn_gateway(&message_type, conn, &mut status)
                    .await
            }
            NotificationChannel::Ios(apns) => self.deliver_ios(apns).await,
            NotificationChannel::Email(email) => self.deliver_email(email).await,
        };
        recusion_tail.push(result);
        let res = recusion_tail
            .last()
            .expect("we just pushed, this cannot fail");

        match (res, node.on_failure) {
            (Ok(_), _) | (Err(_), None) => recusion_tail,
            (Err(_), Some(fallback)) => {
                return Box::pin(self.deliver_notification_inner(
                    message_type,
                    *fallback,
                    recusion_tail,
                ))
                .await;
            }
        }
    }

    /// Deliver via connection gateway (WebSocket).
    async fn deliver_conn_gateway(
        &self,
        message_type: &str,
        conn: &ConnGatewayNotification<'static, serde_json::Value>,
        status: &mut DeliveryStatus,
    ) -> Result<DeliverySuccess, Report> {
        let notifications: Vec<_> = conn
            .recipients
            .iter()
            .map(|r| (r.clone(), &conn.notif))
            .collect();

        let delivered = self
            .websocket
            .send_notifications(message_type, notifications)
            .await?;
        status.websocket_delivered.extend(delivered);
        Ok(DeliverySuccess::ConnGateway)
    }

    /// Deliver via iOS push (APNS).
    async fn deliver_ios(
        &self,
        _apns: &crate::domain::models::queue_message::APNSTargets<serde_json::Value>,
    ) -> Result<DeliverySuccess, Report> {
        // TODO: Implement iOS push delivery
        Ok(DeliverySuccess::Ios)
    }

    /// Deliver via email.
    async fn deliver_email(
        &self,
        _email: &EmailNotification<'static>,
    ) -> Result<DeliverySuccess, Report> {
        // TODO: Implement email delivery
        Ok(DeliverySuccess::Email)
    }
}
