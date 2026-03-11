//! Port definitions (interfaces) for the notification service.
//!
//! These traits define the boundaries between the domain logic and external
//! dependencies, following hexagonal architecture principles.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use models_pagination::{CreatedAt, Query};

use crate::domain::models::device::DeviceType;

use crate::domain::models::email_notification_digest::ports::{ClaimResult, DigestBatch};
use crate::domain::models::{
    DeviceEndpoint, Notification, NotificationExtEmail, NotificationIdAndCollapseKey,
    RateLimitConfig, RateLimitKey, RateLimitResult, SendNotificationRequestBuilder,
    UserNotificationRow, android::FCMMessage, apple::APNSPushNotification,
    mobile::MessageAttributes,
};

/// Port for sending mobile push notifications (iOS/Android via SNS).
pub trait NotificationSender: Send + Sync + 'static {
    /// Send an iOS push notification via APNS.
    ///
    /// Returns the SNS message ID on success (used for delivery failure tracking).
    fn send_ios_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &APNSPushNotification<T>,
        attributes: &MessageAttributes,
    ) -> impl Future<Output = Result<String, Report>> + Send;

    /// Send an Android push notification via FCM.
    ///
    /// Returns the SNS message ID on success (used for delivery failure tracking).
    fn send_android_push_notification<T: Serialize + Send + Sync>(
        &self,
        endpoint_arn: &str,
        notification: &FCMMessage<T>,
        attributes: &MessageAttributes,
    ) -> impl Future<Output = Result<String, Report>> + Send;
}

/// Port for rate limiting operations.
pub trait RateLimitPort: Send + Sync + 'static {
    /// Check if the action is allowed and increment the counter.
    ///
    /// The `RateLimitKey` is a hashed value - callers control what gets rate
    /// limited by constructing the key from relevant data.
    fn check_and_increment(
        &self,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitResult, Report>> + Send;
}

/// Port for notification persistence operations.
pub trait NotificationRepository: Send + Sync + 'static {
    /// Get users who have muted notifications.
    fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;

    /// Get users who have unsubscribed from notifications for a specific item.
    fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;

    /// Create a notification and user notification records.
    ///
    /// Returns the notification ID if successful, or None if it already exists
    /// (idempotent operation).
    fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> impl Future<Output = Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report>> + Send;

    /// Update the sent status for users who received the notification.
    fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Get device endpoints for push notifications.
    fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report>> + Send;

    /// Mark notifications as seen for a user.
    fn mark_notifications_seen(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Mark notifications as done or undone for a user.
    fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Get basic notification data (collapse keys) needed for push clearing.
    fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<NotificationIdAndCollapseKey>, Report>> + Send;

    /// Get a user's active (not deleted, not done) notifications with cursor-based pagination.
    ///
    /// The metadata JSON column is deserialized into `T`.
    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send;

    /// Get a user's active notifications filtered by event item IDs, with cursor-based pagination.
    ///
    /// Only returns notifications that are not deleted and not done,
    /// matching one of the provided `event_item_ids`.
    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send;

    /// Get a single user notification by ID.
    ///
    /// Returns `None` if no active (non-deleted) notification exists for the given user and ID.
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

    /// Hard-delete all notifications for a user.
    fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Look up an existing device endpoint ARN by its device token.
    ///
    /// Returns `None` if no registration exists for this token.
    fn get_device_endpoint(
        &self,
        device_token: &str,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;

    /// Upsert a device registration: create a new one or update the existing
    /// record if the endpoint already exists.
    fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Delete the device registration matching the given token and type.
    ///
    /// Returns the endpoint ARN that was removed.
    fn delete_device_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> impl Future<Output = Result<String, Report>> + Send;

    /// Delete a device registration by its endpoint ARN.
    fn delete_device_by_endpoint(
        &self,
        endpoint_arn: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port for WebSocket delivery via connection gateway.
pub trait WebSocketSender: Send + Sync + 'static {
    /// Send notifications to users via WebSocket.
    ///
    /// Returns the set of users who successfully received the notification
    /// (i.e., they were online and the message was delivered).
    fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> impl Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;
}

use crate::domain::models::queue_message::EmailContent;

/// Port for email delivery.
pub trait EmailSender: Send + Sync + 'static {
    /// Send an email with pre-built content to a user.
    fn send_email(
        &self,
        recipient: MacroUserIdStr<'_>,
        content: &EmailContent,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

use crate::domain::models::push_notification_event::RawPushNotificationEventMessage;
use crate::domain::models::queue_message::{DeliverySuccess, QueueMessage, RawQueueMessage};

/// Port for publishing notifications to delivery queue and receiving them.
pub trait NotificationQueue: Send + Sync + 'static {
    /// Publish notifications for async delivery (after DB persistence).
    fn publish<'a, T: Serialize + Send + Sync, U: Serialize + Send + Sync>(
        &self,
        messages: impl Iterator<Item = QueueMessage<'a, T, U>> + Send,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Receive messages from the queue (for worker).
    fn receive_messages(&self)
    -> impl Future<Output = Result<Vec<RawQueueMessage>, Report>> + Send;

    /// Delete a message from the queue (after successful delivery).
    fn delete_message(
        &self,
        receipt_handle: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port for delivering notifications from the queue.
///
/// This trait defines the egress (outbound delivery) side of the notification
/// system. Implementations poll the queue and deliver via WebSocket, push, and email.
pub trait NotificationEgress: Send + Sync + 'static {
    /// Poll the queue and attempt to deliver notifications.
    ///
    /// Returns results for each delivery attempt across all messages received.
    /// Messages are automatically deleted from the queue after successful delivery.
    fn poll_and_deliver(&self)
    -> impl Future<Output = Vec<Result<DeliverySuccess, Report>>> + Send;

    /// Poll for ready digest batches, template them as emails, and send.
    fn poll_email_digests<T: NotificationExtEmail>(
        &self,
        f: fn(DigestBatch) -> Result<T, Report>,
    ) -> impl Future<Output = Result<ClaimResult<()>, Report>> + Send;
}

/// Port for SNS platform endpoint management (create, get/set attributes).
pub trait SnsEndpointManager: Send + Sync + 'static {
    /// Create a new SNS platform endpoint for the given platform ARN and device token.
    ///
    /// Returns the new endpoint ARN.
    fn create_platform_endpoint(
        &self,
        platform_arn: &str,
        token: &str,
    ) -> impl Future<Output = Result<String, Report>> + Send;

    /// Get the attributes of an existing SNS endpoint.
    fn get_endpoint_attributes(
        &self,
        endpoint_arn: &str,
    ) -> impl Future<Output = Result<HashMap<String, String>, Report>> + Send;

    /// Set/update attributes on an existing SNS endpoint.
    fn set_endpoint_attributes(
        &self,
        endpoint_arn: &str,
        attributes: HashMap<String, String>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Delete an SNS platform endpoint by its ARN.
    fn delete_endpoint(
        &self,
        endpoint_arn: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port for receiving and acknowledging push notification event messages from a queue.
pub trait PushNotificationEventQueue: Send + Sync + 'static {
    /// Receive a batch of raw push notification event messages from the queue.
    fn receive_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<RawPushNotificationEventMessage>, Report>> + Send;

    /// Delete a message from the queue after successful processing.
    fn delete_message(
        &self,
        receipt_handle: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
