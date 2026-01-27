//! Ingress service for sending notifications.
//!
//! This service handles the caller-facing side of notifications:
//! filtering recipients, persisting to DB, and publishing to the queue.

use itertools::Itertools;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use std::collections::HashSet;
use uuid::Uuid;

use crate::domain::models::queue_message::{
    ConnGatewayNotification, Node, NotificationChannel, QueueMessage,
};
use crate::domain::models::recipient::FilteredRecipient;
use crate::domain::models::{
    ExclusionReason, Notification, NotificationResult, RecipientExclusion, RevokeCriteria,
    SendNotificationRequest, SendNotificationRequestBuilder,
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
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        let (allowed, excluded): (Vec<_>, Vec<_>) = self
            .filter_recipients(
                request.req.sender_id.as_ref(),
                &request.req.recipient_ids,
                &request.req.notification_entity.entity_id,
            )
            .await
            .context(SendNotificationError::Other)?
            .into_iter()
            .partition_map(|r| match r {
                FilteredRecipient::Allowed(macro_user_id_str) => {
                    itertools::Either::Left(macro_user_id_str)
                }
                FilteredRecipient::Excluded(recipient_exclusion) => {
                    itertools::Either::Right(recipient_exclusion)
                }
            });

        if allowed.is_empty() {
            return Ok(None);
        }

        // Create notification in DB
        let notification_id = Uuid::now_v7();
        let created = self
            .repository
            .create_notification(&request.req, notification_id, &self.service_name, &allowed)
            .await
            .context(SendNotificationError::Other)?;

        // If notification already exists (idempotent), return early
        let Some(notification_id) = created else {
            return Ok(Some(NotificationResult {
                notification_id,
                notified_recipients: HashSet::new(),
            }));
        };

        // Build and publish QueueMessage
        let queue_message = self.build_queue_message(&request, &allowed)?;

        self.queue
            .publish(&queue_message)
            .await
            .context(SendNotificationError::Other)?;

        // Return result (delivery happens async)
        Ok(Some(NotificationResult {
            notification_id,
            notified_recipients: allowed.into_iter().map(CowLike::into_owned).collect(),
        }))
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
        recipient_ids: &'a [MacroUserIdStr<'a>],
        item_id: &str,
    ) -> Result<Vec<FilteredRecipient<'a>>, Report> {
        // Fetch all filter data upfront
        let (muted_users, unsubscribed_users) = tokio::try_join!(
            self.repository.get_muted_users(recipient_ids),
            self.repository
                .get_unsubscribed_users(item_id, recipient_ids),
        )?;

        let recipient_is_sender = |id: FilteredRecipient<'a>| match (id, sender_id) {
            (FilteredRecipient::Allowed(macro_user_id_str), Some(sender))
                if sender == &macro_user_id_str =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::IsSender,
                })
            }
            (x, _) => x,
        };

        let user_muted_notifs = |id: FilteredRecipient<'a>| match id {
            FilteredRecipient::Allowed(macro_user_id_str)
                if muted_users.contains(&macro_user_id_str) =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::MutedNotifications,
                })
            }
            x => x,
        };

        let notif_type_is_ignored = |id: FilteredRecipient<'a>| match id {
            FilteredRecipient::Allowed(macro_user_id_str)
                if unsubscribed_users.contains(&macro_user_id_str) =>
            {
                FilteredRecipient::Excluded(RecipientExclusion {
                    user_id: macro_user_id_str,
                    reason: ExclusionReason::UnsubscribedFromItem,
                })
            }
            x => x,
        };

        // Build exclusion reasons for excluded recipients
        Ok(recipient_ids
            .into_iter()
            .map(CowLike::copied)
            .map(FilteredRecipient::Allowed)
            .map(recipient_is_sender)
            .map(user_muted_notifs)
            .map(notif_type_is_ignored)
            .collect())
    }

    /// Build a QueueMessage with delivery nodes for the notification.
    fn build_queue_message<'a, T: Notification + Serialize + Clone>(
        &self,
        notification: &SendNotificationRequest<T>,
        recipients: &[MacroUserIdStr<'a>],
    ) -> Result<Vec<QueueMessage<'a, T>>, Report<SendNotificationError>> {
        let rate_limit = notification.req.get_rate_limit()?;

        // TODO: we need to read the fields for build_apns, build_email and send_conn_gateway to determine the queuemessages to return.
        // Note that conn_gateway messages are 1:M users while the others are 1:1

        Ok(vec![QueueMessage {
            message_type: T::TYPE_NAME.to_string(),
            rate_limit,
            content: Node {
                notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                    notif: notification.req.notification.clone(),
                    recipients: recipients.to_vec(),
                }),
                on_failure: None,
            },
        }])
    }
}
