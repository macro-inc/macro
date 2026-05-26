//! Ingress service for sending notifications.
//!
//! This service handles the caller-facing side of notifications:
//! filtering recipients, persisting to DB, and publishing to the queue.

use crate::domain::models::apple::{APNSPushNotification, Aps};
use crate::domain::models::device::DeviceType;
use crate::domain::models::email_notification_digest::BulkDigestStateMachine;
use crate::domain::models::mobile::{MessageAttributes, PushType};
use crate::domain::models::queue_message::IngressQueueMessage;
use crate::domain::models::queue_message::{
    APNSTargets, ClearPushIdentifier, ConnGatewayNotification, QueueMessage,
    QueueMessageNeedsStateMachine, UserApnsEndpoints,
};
use crate::domain::models::request::{
    BuildApnsOutput, GetNotificationsByEventItemIdsRequest, NotificationListFilters,
    NotificationStatus, SendNotificationRequest, UpdateNotificationsRequest,
};
use crate::domain::models::{
    DeviceEndpoint, DisabledNotificationType, Notification, NotificationResult,
    NotificationStatusUpdate, NotificationTypeName, UserNotificationRow,
    UserNotificationStatusUpdate,
};
use crate::domain::ports::{
    NoopNotificationRealtimePublisher, NotificationIngressQueue, NotificationQueue,
    NotificationRealtimePublisher, NotificationRepository, SnsEndpointManager,
};
use crate::domain::service::SendNotificationError;
use ::futures::future::join_all;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, PaginateOn, Paginated, Query, TypeEraseCursor};
use rootcause::Report;
use rootcause::prelude::ResultExt;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Trait for sending notifications through the ingress service.
pub trait NotificationIngress: Send + Sync + 'static {
    /// Send a notification to the specified recipients.
    fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> impl Future<Output = Result<Option<NotificationResult<'a>>, Report<SendNotificationError>>> + Send;
}

/// Trait for reading and updating notifications.
///
/// This is separated from [`NotificationIngress`] because these operations
/// do not require the bulk-digest state machine.
pub trait NotificationReader: Send + Sync + 'static {
    /// Mark notifications as seen for a user and enqueue push notification clearing.
    fn update_notifications(
        &self,
        req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Get a user's non-deleted notifications, paginated.
    ///
    /// Returns at most `limit` (default 20, max 500) notifications matching
    /// the status filters, ordered by creation time descending.
    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: Option<u32>,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send;

    /// Get a user's non-deleted notifications filtered by event item IDs, paginated.
    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        req: GetNotificationsByEventItemIdsRequest<'_>,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send;

    /// Get a single user notification by ID.
    fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl Future<Output = Result<Option<UserNotificationRow<T>>, Report>> + Send;

    /// Soft-delete a single user notification.
    fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Soft-delete multiple user notifications.
    fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Register a device for push notifications.
    ///
    /// Resolves the SNS platform endpoint (creating or re-enabling as needed),
    /// then upserts the device registration in the database.
    fn register_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Unregister a device from push notifications.
    ///
    /// Deletes the device registration from the database (by token + type),
    /// then deletes the SNS endpoint.
    fn unregister_device(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Get all disabled notification types for a user.
    fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send;

    /// Disable a notification type for a user.
    fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Re-enable a notification type for a user.
    fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Service for sending notifications (ingress side).
///
/// Handles recipient filtering, DB persistence, and queue publishing.
/// Does NOT handle delivery - that's done by [`super::NotificationEgressService`].
pub struct NotificationIngressService<N, Q, S> {
    repository: N,
    queue: Q,
    state_machine_driver: S,
    service_name: &'static str,
}

impl<N, Q, S> NotificationIngress for NotificationIngressService<N, Q, S>
where
    N: NotificationRepository,
    Q: NotificationQueue,
    S: BulkDigestStateMachine,
{
    fn send_notification<'a, T: Notification + Clone, U: Serialize + Send + Sync + 'static>(
        &'a self,
        request: SendNotificationRequest<'a, T, U>,
    ) -> impl Future<Output = Result<Option<NotificationResult<'a>>, Report<SendNotificationError>>> + Send
    {
        self.send_notification_impl(request)
    }
}

impl<N, Q, S> NotificationIngressService<N, Q, S>
where
    N: NotificationRepository,
    Q: NotificationQueue,
    S: BulkDigestStateMachine,
{
    /// Create a new ingress service.
    pub fn new(repository: N, queue: Q, state_machine_driver: S) -> Self {
        Self {
            repository,
            queue,
            state_machine_driver,
            service_name: std::env!("CARGO_PKG_NAME"),
        }
    }

    /// Send a notification to the specified recipients.
    ///
    /// This method performs the following steps:
    /// 1. Filter recipients (remove sender, muted users, unsubscribed users)
    /// 2. Create notification in the database
    /// 3. Build and publish QueueMessage to SQS
    /// 4. Return result (delivery happens async via worker)
    async fn send_notification_impl<
        'a,
        T: Clone + Serialize + Send + Sync + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        request: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        let notification_id = request.uuid_to_write;
        let mut request = self
            .filter_recipients(request)
            .await
            .context(SendNotificationError::Other)?;

        if request.req.recipient_ids.is_empty() {
            return Ok(None);
        }

        let (queue_messages, apns_collapse_key) = self
            .build_queue_message(notification_id, &mut request)
            .await?;

        let notified_recipients = request.req.recipient_ids.clone();

        // Create notification in DB (with collapse key if APNS was built)
        let created = self
            .repository
            .create_notification(
                request.req,
                notification_id,
                self.service_name,
                apns_collapse_key.as_deref(),
            )
            .await
            .context(SendNotificationError::Other)?;

        // If notification already exists (idempotent), return early
        let Some(n) = created else {
            return Ok(Some(NotificationResult {
                notification_id,
                notified_recipients: HashSet::new(),
            }));
        };

        // get the timestamp info back out of the db created values
        let first = n
            .first()
            .ok_or_else(|| rootcause::report!("create_notification returned empty Vec"))
            .context(SendNotificationError::Other)?;
        let (created_at, updated_at) = (first.created_at, first.updated_at);

        let results = join_all(
            n.into_iter()
                .map(|user_notif| self.state_machine_driver.ingest(user_notif)),
        )
        .await;

        self.queue
            .publish(
                queue_messages
                    .with_state_decisions(results)
                    .map(|msg| msg.with_timestamps(created_at, updated_at))
                    .collect(),
            )
            .await
            .context(SendNotificationError::Other)?;

        // Return result (delivery happens async)
        Ok(Some(NotificationResult {
            notification_id,
            notified_recipients,
        }))
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
        let notification_type = req.req.notification.tag.as_ref();

        // Fetch all filter data upfront
        let (muted_users, unsubscribed_users, type_disabled_users) = tokio::try_join!(
            self.repository.get_muted_users(&recipient_ids),
            self.repository
                .get_unsubscribed_users(&req.req.notification_entity.entity_id, &recipient_ids),
            self.repository
                .get_users_with_type_disabled(notification_type, &recipient_ids),
        )?;

        let (out, _excluded) =
            req.update_recipients(muted_users, unsubscribed_users, type_disabled_users);
        Ok(out)
    }

    /// Build queue messages for each delivery channel.
    ///
    /// - `send_conn_gateway`: Creates a single message for all recipients (1:M)
    /// - `build_apns`: Creates one message per recipient with their device endpoints (1:1)
    /// - `build_email`: Creates one message per recipient (1:1)
    ///   Returns `(queue_messages, apns_collapse_key)`.
    async fn build_queue_message<
        'a,
        T: Clone + Serialize + Send + Sync,
        U: Serialize + Send + Sync,
    >(
        &self,
        notification_id: Uuid,
        notification: &mut SendNotificationRequest<'a, T, U>,
    ) -> Result<
        (QueueMessageNeedsStateMachine<'a, T, U>, Option<String>),
        Report<SendNotificationError>,
    > {
        let mut messages = Vec::new();
        let mut apns_collapse_key = None;
        let typename = &notification.req.notification.tag;

        // Connection gateway: 1:M (single message for all recipients)
        if notification.send_conn_gateway {
            messages.push(QueueMessage::new_from_conn_gateway(
                ConnGatewayNotification::clone_from_request(notification_id, notification),
            ));
        }

        // APNS (iOS push): 1:M (single message for all recipients' device endpoints)
        if let Some(build_apns) = notification.build_apns.take() {
            let recipients_vec: Vec<_> = notification.req.recipient_ids.iter().cloned().collect();
            let device_endpoints = self
                .repository
                .get_device_endpoints(&recipients_vec)
                .await
                .context(SendNotificationError::Other)?;

            let ios_endpoints: std::collections::HashMap<_, _> = device_endpoints
                .into_iter()
                .filter_map(|(user_id, endpoints)| {
                    let ios: Vec<String> = endpoints
                        .into_iter()
                        .filter_map(|e| match e {
                            DeviceEndpoint::Ios(arn) => Some(arn),
                            DeviceEndpoint::Android(_) | DeviceEndpoint::IosVoip(_) => None,
                        })
                        .collect();
                    if ios.is_empty() {
                        None
                    } else {
                        Some((
                            user_id,
                            UserApnsEndpoints {
                                endpoints: ios,
                                digest_state: None,
                            },
                        ))
                    }
                })
                .collect();

            if !ios_endpoints.is_empty() {
                let BuildApnsOutput { notif, attr } = build_apns;
                apns_collapse_key = Some(attr.collapse_key.clone());
                messages.push(QueueMessage::new_from_apns(
                    APNSTargets {
                        notif,
                        attributes: attr,
                        ios_device_endpoints: ios_endpoints,
                    },
                    typename,
                ));
            }
        }

        // Email: 1:1 (one message per recipient)
        if let Some(ref build_email) = notification.build_email {
            for recipient in &notification.req.recipient_ids {
                let email_content = build_email.clone();
                messages.push(QueueMessage::new_from_email(
                    email_content.with_recipient(recipient.clone()),
                    typename,
                ));
            }
        }

        Ok((
            QueueMessageNeedsStateMachine::new(messages),
            apns_collapse_key,
        ))
    }

    /// Process a type-erased notification request from the ingress queue.
    ///
    /// This accepts `serde_json::Value` types (deserialized from the ingress
    /// queue) and calls `send_notification_impl` directly, bypassing the
    /// `T: Notification` trait bound on the public trait method.
    pub async fn process_from_queue<'a>(
        &'a self,
        request: SendNotificationRequest<'a, serde_json::Value, serde_json::Value>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        self.send_notification_impl(request).await
    }
}

/// A lightweight [`NotificationIngress`] implementation that serializes
/// the request and publishes to an ingress queue.
///
/// Callers only need a queue client — no database, Redis, or state-machine
/// dependencies. A worker in `notification_service` picks up messages from
/// this queue and processes them through [`NotificationIngressService`].
///
/// `send_notification` always returns `Ok(None)` because the actual
/// processing is deferred to the worker.
#[derive(Clone)]
pub struct SqsNotificationIngress<Q> {
    /// the inner queue
    pub queue: Q,
}

impl<Q: NotificationIngressQueue> NotificationIngress for SqsNotificationIngress<Q> {
    async fn send_notification<
        'a,
        T: Notification + Clone,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        let message =
            IngressQueueMessage::from_request(&req).context(SendNotificationError::Other)?;
        self.queue
            .publish(message)
            .await
            .context(SendNotificationError::Other)?;
        Ok(None)
    }
}

/// Configuration for SNS platform ARNs.
pub struct PlatformArnConfig {
    /// SNS platform ARN for iOS (APNS).
    pub apns_platform_arn: String,
    /// SNS platform ARN for Android (FCM).
    pub fcm_platform_arn: String,
    /// SNS platform ARN for iOS VoIP (APNS_VOIP).
    pub apns_voip_platform_arn: String,
}

/// Service for reading and updating notifications.
///
/// Handles notification queries, status updates, and deletion.
/// Does not require a bulk-digest state machine.
pub struct NotificationReaderService<N, Q, S, R = NoopNotificationRealtimePublisher> {
    /// Notification repository.
    pub repository: N,
    /// Queue used to enqueue notification work.
    pub queue: Q,
    /// SNS endpoint manager.
    pub sns_endpoint: S,
    /// Platform ARN configuration.
    pub platform_config: PlatformArnConfig,
    /// Realtime update publisher.
    pub realtime: R,
}

impl<N, Q, S, R> NotificationReaderService<N, Q, S, R>
where
    N: NotificationRepository,
    Q: NotificationQueue,
    S: SnsEndpointManager,
    R: NotificationRealtimePublisher,
{
    /// Update notification status for a user and optionally enqueue push notification clearing.
    ///
    /// This method performs the following steps:
    /// 1. Update the notification status in the database (seen/done/undone)
    /// 2. If the status change should clear push notifications:
    ///    a. Look up collapse keys for the given notifications
    ///    b. Look up the user's iOS device endpoints
    ///    c. Publish silent background push messages to clear badges on devices
    #[tracing::instrument(err, skip(self))]
    async fn update_notifications_impl(
        &self,
        req: UpdateNotificationsRequest<'_>,
    ) -> Result<(), Report> {
        let changed = match &req.status {
            NotificationStatus::Seen => {
                self.repository
                    .mark_notifications_seen(req.user_id.copied(), req.notification_ids)
                    .await?
            }
            NotificationStatus::Done(done) => {
                self.repository
                    .mark_notifications_done(&req.user_id, req.notification_ids, *done)
                    .await?
            }
        };

        if !changed.is_empty() {
            let update = UserNotificationStatusUpdate {
                user: req.user_id.copied(),
                update: NotificationStatusUpdate::new(changed),
            };
            if let Err(err) = self.realtime.publish_updates(&[update]).await {
                tracing::warn!(error = ?err, "failed to publish notification status realtime update");
            }
        }

        if !req.status.should_clear_push_notifs() {
            return Ok(());
        }

        let notifications_with_keys = self
            .repository
            .get_basic_notifications(req.notification_ids)
            .await?;

        if notifications_with_keys.is_empty() {
            return Ok(());
        }

        let device_endpoints = self
            .repository
            .get_device_endpoints(&[req.user_id.copied()])
            .await?;

        let ios_endpoints: std::collections::HashMap<_, _> = device_endpoints
            .into_iter()
            .filter_map(|(user_id, endpoints)| {
                let ios: Vec<String> = endpoints
                    .into_iter()
                    .filter_map(|e| match e {
                        DeviceEndpoint::Ios(arn) => Some(arn),
                        DeviceEndpoint::Android(_) | DeviceEndpoint::IosVoip(_) => None,
                    })
                    .collect();
                if ios.is_empty() {
                    None
                } else {
                    Some((
                        user_id,
                        UserApnsEndpoints {
                            endpoints: ios,
                            digest_state: None,
                        },
                    ))
                }
            })
            .collect();

        if ios_endpoints.is_empty() {
            return Ok(());
        }

        let messages: Vec<QueueMessage<'_, ClearPushIdentifier, ClearPushIdentifier>> =
            notifications_with_keys
                .into_iter()
                .map(|n| {
                    let collapse_key = n.apns_collapse_key;

                    let notif = ClearPushIdentifier {
                        identifier: collapse_key.clone(),
                    };

                    let typename = NotificationTypeName::new_from_notif(&notif);

                    QueueMessage::new_from_apns(
                        APNSTargets {
                            notif: APNSPushNotification {
                                aps: Aps {
                                    content_available: Some(1),
                                    sound: None,
                                    ..Default::default()
                                },
                                push_notification_data: notif.clone(),
                            },
                            attributes: MessageAttributes {
                                push_type: PushType::Background,
                                collapse_key,
                            },
                            ios_device_endpoints: ios_endpoints.clone(),
                        },
                        &typename,
                    )
                })
                .collect();

        self.queue.publish(messages).await?;

        Ok(())
    }
}

impl<N, Q, S, R> NotificationReader for NotificationReaderService<N, Q, S, R>
where
    N: NotificationRepository,
    Q: NotificationQueue,
    S: SnsEndpointManager,
    R: NotificationRealtimePublisher,
{
    fn update_notifications(
        &self,
        req: UpdateNotificationsRequest<'_>,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        self.update_notifications_impl(req)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: Option<u32>,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Paginated<UserNotificationRow<T>, String>, Report> {
        let limit = limit.unwrap_or(20).min(500);

        let rows = self
            .repository
            .get_user_notifications::<T>(user_id, limit, cursor, filters)
            .await?;

        let paginated = rows
            .into_iter()
            .paginate_on(limit as usize, CreatedAt)
            .into_page()
            .type_erase();

        Ok(paginated)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        req: GetNotificationsByEventItemIdsRequest<'_>,
    ) -> Result<Paginated<UserNotificationRow<T>, String>, Report> {
        let limit = req.limit.unwrap_or(20).min(500);

        let rows = self
            .repository
            .get_user_notifications_by_event_item_ids::<T>(
                req.user_id,
                req.event_item_ids,
                limit,
                req.cursor,
                req.filters,
            )
            .await?;

        let paginated = rows
            .into_iter()
            .paginate_on(limit as usize, CreatedAt)
            .into_page()
            .type_erase();

        Ok(paginated)
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        self.repository
            .get_user_notification_by_id::<T>(user_id, notification_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        self.repository
            .delete_user_notification(user_id, notification_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        self.repository
            .bulk_delete_user_notifications(user_id, notification_ids)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn register_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        let platform_arn: &str = match device_type {
            DeviceType::Ios => self.platform_config.apns_platform_arn.as_str(),
            DeviceType::Android => self.platform_config.fcm_platform_arn.as_str(),
            DeviceType::IosVoip => self.platform_config.apns_voip_platform_arn.as_str(),
        };

        // Get endpoint if exists, otherwise create new one
        let endpoint = match self.repository.get_device_endpoint(device_token).await {
            Ok(Some(endpoint)) => endpoint,
            _ => {
                self.sns_endpoint
                    .create_platform_endpoint(platform_arn, device_token)
                    .await?
            }
        };

        // Verify endpoint validity, update or create new endpoint if needed
        let endpoint = match self.sns_endpoint.get_endpoint_attributes(&endpoint).await {
            Err(_) => {
                self.sns_endpoint
                    .create_platform_endpoint(platform_arn, device_token)
                    .await?
            }
            Ok(attributes) => match (attributes.get("Enabled"), attributes.get("Token")) {
                (Some(endpoint_enabled), Some(endpoint_token))
                    if endpoint_enabled == "false" || endpoint_token != device_token =>
                {
                    self.sns_endpoint
                        .set_endpoint_attributes(
                            &endpoint,
                            HashMap::from([
                                ("Enabled".to_string(), "true".to_string()),
                                ("Token".to_string(), device_token.to_string()),
                            ]),
                        )
                        .await?;

                    endpoint
                }
                _ => endpoint,
            },
        };

        self.repository
            .upsert_device(user_id, device_token, &endpoint, device_type)
            .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn unregister_device(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        let endpoint = self
            .repository
            .delete_device_by_token(device_token, device_type)
            .await?;

        self.sns_endpoint.delete_endpoint(&endpoint).await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<DisabledNotificationType>, Report> {
        self.repository
            .get_disabled_notification_types(user_id)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        type_name: &str,
    ) -> Result<(), Report> {
        self.repository
            .disable_notification_type(user_id, type_name)
            .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        type_name: &str,
    ) -> Result<(), Report> {
        self.repository
            .enable_notification_type(user_id, type_name)
            .await
    }
}
