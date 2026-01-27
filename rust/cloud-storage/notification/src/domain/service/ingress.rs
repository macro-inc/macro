//! Ingress service for sending notifications.
//!
//! This service handles the caller-facing side of notifications:
//! filtering recipients, persisting to DB, and publishing to the queue.

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::models::queue_message::{ConnGatewayNotification, Node, NotificationChannel, QueueMessage};
use crate::domain::models::{
    ExclusionReason, FilteredRecipients, Notification, NotificationResult, RecipientExclusion,
    RevokeCriteria, SendNotificationRequest, SendNotificationRequestBuilder,
};
use crate::domain::ports::{NotificationQueue, NotificationRepository};
use crate::domain::service::{MissingRevokeFilter, SendNotificationError};

/// Service for sending notifications (ingress side).
///
/// Handles recipient filtering, DB persistence, and queue publishing.
/// Does NOT handle delivery - that's done by [`super::NotificationEgressService`].
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
    /// 1. Filter recipients (remove sender, muted users, unsubscribed users)
    /// 2. Create notification in the database
    /// 3. Build and publish QueueMessage to SQS
    /// 4. Return result (delivery happens async via worker)
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

        // Create notification in DB
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

        // Build and publish QueueMessage
        let queue_message = self.build_queue_message(&request.req, &filtered.valid)?;

        self.queue
            .publish(&queue_message)
            .await
            .context(SendNotificationError::Other)?;

        // Return result (delivery happens async)
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
