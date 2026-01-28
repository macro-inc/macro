//! Ingress service for sending notifications.
//!
//! This service handles the caller-facing side of notifications:
//! filtering recipients, persisting to DB, and publishing to the queue.

use crate::domain::models::queue_message::{
    APNSTargets, ConnGatewayNotification, EmailNotification, Node, NotificationChannel,
    QueueMessage,
};
use crate::domain::models::recipient::FilteredRecipient;
use crate::domain::models::{
    DeviceEndpoint, ExclusionReason, Notification, NotificationResult, RecipientExclusion,
    SendNotificationRequest,
};
use crate::domain::ports::{NotificationQueue, NotificationRepository};
use crate::domain::service::SendNotificationError;
use itertools::Itertools;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use std::collections::HashSet;
use uuid::Uuid;

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
        let recipients: Vec<_> = request.req.recipient_ids.iter().cloned().collect();
        let (allowed, _excluded): (Vec<_>, Vec<_>) = self
            .filter_recipients(
                request.req.sender_id.as_ref(),
                &recipients,
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

        let mut req =
            request.update_recipients(allowed.into_iter().map(CowLike::into_owned).collect());

        // Build and publish QueueMessage
        let queue_messages = self.build_queue_message(&mut req).await?;

        self.queue
            .publish(&queue_messages)
            .await
            .context(SendNotificationError::Other)?;

        // Return result (delivery happens async)
        Ok(Some(NotificationResult {
            notification_id,
            notified_recipients: req.req.recipient_ids,
        }))
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
            .iter()
            .map(CowLike::copied)
            .map(FilteredRecipient::Allowed)
            .map(recipient_is_sender)
            .map(user_muted_notifs)
            .map(notif_type_is_ignored)
            .collect())
    }

    /// Build queue messages for each delivery channel.
    ///
    /// - `send_conn_gateway`: Creates a single message for all recipients (1:M)
    /// - `build_apns`: Creates one message per recipient with their device endpoints (1:1)
    /// - `build_email`: Creates one message per recipient (1:1)
    async fn build_queue_message<'a, T: Notification + Serialize + Clone>(
        &self,
        notification: &mut SendNotificationRequest<'a, T>,
    ) -> Result<Vec<QueueMessage<'a, T>>, Report<SendNotificationError>> {
        let rate_limit = notification.req.get_rate_limit()?;
        let message_type = T::TYPE_NAME.to_string();
        let mut messages = Vec::new();

        // Connection gateway: 1:M (single message for all recipients)
        if notification.send_conn_gateway {
            messages.push(QueueMessage {
                message_type: message_type.clone(),
                rate_limit: rate_limit.clone(),
                content: Node {
                    notif: NotificationChannel::ConnGateway(ConnGatewayNotification {
                        notif: notification.req.notification.clone(),
                        recipients: notification.req.recipient_ids.iter().cloned().collect(),
                    }),
                    on_failure: None,
                },
            });
        }

        // APNS (iOS push): 1:M (single message for all recipients' device endpoints)
        if let Some(ref mut build_apns) = notification.build_apns {
            let recipients_vec: Vec<_> = notification.req.recipient_ids.iter().cloned().collect();
            let device_endpoints = self
                .repository
                .get_device_endpoints(&recipients_vec)
                .await
                .context(SendNotificationError::Other)?;

            let ios_endpoints: Vec<String> = device_endpoints
                .values()
                .flatten()
                .filter_map(|e| match e {
                    DeviceEndpoint::Ios(arn) => Some(arn.clone()),
                    DeviceEndpoint::Android(_) => None,
                })
                .collect();

            if !ios_endpoints.is_empty() {
                let (apns_notif, attributes) = build_apns(notification.req.notification.clone());
                messages.push(QueueMessage {
                    message_type: message_type.clone(),
                    rate_limit: rate_limit.clone(),
                    content: Node {
                        notif: NotificationChannel::Ios(Box::new(APNSTargets {
                            notif: apns_notif,
                            attributes,
                            ios_device_endpoints: ios_endpoints,
                        })),
                        on_failure: None,
                    },
                });
            }
        }

        // Email: 1:1 (one message per recipient)
        if let Some(ref mut build_email) = notification.build_email {
            for recipient in &notification.req.recipient_ids {
                let email_content = build_email(notification.req.notification.clone());
                messages.push(QueueMessage {
                    message_type: message_type.clone(),
                    rate_limit: rate_limit.clone(),
                    content: Node {
                        notif: NotificationChannel::Email(EmailNotification {
                            to: recipient.clone(),
                            content: email_content,
                        }),
                        on_failure: None,
                    },
                });
            }
        }

        Ok(messages)
    }
}
