//! Ingress service for sending notifications.
//!
//! This service handles the caller-facing side of notifications:
//! filtering recipients, persisting to DB, and publishing to the queue.

use crate::domain::models::queue_message::{
    APNSTargets, ConnGatewayNotification, EmailNotification, Node, NotificationChannel,
    QueueMessage,
};
use crate::domain::models::{
    DeviceEndpoint, Notification, NotificationResult, SendNotificationRequest,
};
use crate::domain::ports::{NotificationQueue, NotificationRepository};
use crate::domain::service::SendNotificationError;
use macro_user_id::cowlike::CowLike;
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use std::collections::HashSet;
use uuid::Uuid;

/// Trait for sending notifications through the ingress service.
pub trait NotificationIngress: Send + Sync + 'static {
    /// Send a notification to the specified recipients.
    fn send_notification<'a, T: Notification + Clone, U: Serialize + Send + Sync>(
        &self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> impl Future<Output = Result<Option<NotificationResult<'a>>, Report<SendNotificationError>>> + Send;
}

/// Service for sending notifications (ingress side).
///
/// Handles recipient filtering, DB persistence, and queue publishing.
/// Does NOT handle delivery - that's done by [`super::NotificationEgressService`].
pub struct NotificationIngressService<N, Q> {
    repository: N,
    queue: Q,
    service_name: String,
}

impl<N, Q> NotificationIngress for NotificationIngressService<N, Q>
where
    N: NotificationRepository,
    Q: NotificationQueue,
{
    /// Send a notification to the specified recipients.
    ///
    /// This method performs the following steps:
    /// 1. Filter recipients (remove sender, muted users, unsubscribed users)
    /// 2. Create notification in the database
    /// 3. Build and publish QueueMessage to SQS
    /// 4. Return result (delivery happens async via worker)
    async fn send_notification<'a, T: Notification + Clone, U: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        let request = self
            .filter_recipients(request)
            .await
            .context(SendNotificationError::Other)?;

        if request.req.recipient_ids.is_empty() {
            return Ok(None);
        }

        // Build queue messages first so we can extract the APNS collapse key
        let mut request = request;
        let (queue_messages, apns_collapse_key) = self.build_queue_message(&mut request).await?;

        // Create notification in DB (with collapse key if APNS was built)
        let notification_id = Uuid::now_v7();
        let created = self
            .repository
            .create_notification(
                &request.req,
                notification_id,
                &self.service_name,
                apns_collapse_key.as_deref(),
            )
            .await
            .context(SendNotificationError::Other)?;

        // If notification already exists (idempotent), return early
        let Some(notification_id) = created else {
            return Ok(Some(NotificationResult {
                notification_id,
                notified_recipients: HashSet::new(),
            }));
        };

        self.queue
            .publish(&queue_messages)
            .await
            .context(SendNotificationError::Other)?;

        // Return result (delivery happens async)
        Ok(Some(NotificationResult {
            notification_id,
            notified_recipients: request.req.recipient_ids,
        }))
    }
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

    /// Filter recipients based on:
    /// - Sender (sender cannot receive their own notification)
    /// - Muted notifications
    /// - Unsubscribed from item
    async fn filter_recipients<'a, T, U>(
        &self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<SendNotificationRequest<'a, T, U>, Report> {
        let recipient_ids: Vec<_> = req.req.recipient_ids.iter().map(CowLike::copied).collect();

        // Fetch all filter data upfront
        let (muted_users, unsubscribed_users) = tokio::try_join!(
            self.repository.get_muted_users(&recipient_ids),
            self.repository
                .get_unsubscribed_users(&req.req.notification_entity.entity_id, &recipient_ids),
        )?;

        let (out, _excluded) = req.update_recipients(muted_users, unsubscribed_users);
        Ok(out)
    }

    /// Build queue messages for each delivery channel.
    ///
    /// - `send_conn_gateway`: Creates a single message for all recipients (1:M)
    /// - `build_apns`: Creates one message per recipient with their device endpoints (1:1)
    /// - `build_email`: Creates one message per recipient (1:1)
    /// Returns `(queue_messages, apns_collapse_key)`.
    async fn build_queue_message<'a, T: Notification + Clone, U: Serialize + Send + Sync>(
        &self,
        notification: &mut SendNotificationRequest<'a, T, U>,
    ) -> Result<(Vec<QueueMessage<'a, T, U>>, Option<String>), Report<SendNotificationError>> {
        let rate_limit = notification.req.get_rate_limit()?;
        let message_type = T::TYPE_NAME.to_string();
        let mut messages = Vec::new();
        let mut apns_collapse_key = None;

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
                apns_collapse_key = Some(attributes.collapse_key.clone());
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

        Ok((messages, apns_collapse_key))
    }
}
