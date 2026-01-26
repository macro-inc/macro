//! Port definitions (interfaces) for the notification service.
//!
//! These traits define the boundaries between the domain logic and external
//! dependencies, following hexagonal architecture principles.

use std::collections::{HashMap, HashSet};
use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::models::{
    DeviceEndpoint, Notification, RateLimitConfig, RateLimitKey, RateLimitResult, RevokeCriteria,
    SendNotificationRequest,
    android::FCMMessage,
    apple::APNSPushNotification,
    mobile::MessageAttributes,
};

/// Port for sending mobile push notifications (iOS/Android via SNS).
pub trait NotificationSender {
    /// Send an iOS push notification via APNS.
    fn send_ios_push_notification<T: Send>(
        &self,
        notification: APNSPushNotification<T>,
        attributes: MessageAttributes,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Send an Android push notification via FCM.
    fn send_android_push_notification<T: Send>(
        &self,
        notification: FCMMessage<T>,
        attributes: MessageAttributes,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port for rate limiting operations.
pub trait RateLimitPort {
    /// Check if the action is allowed and increment the counter.
    ///
    /// The `RateLimitKey` is a hashed value - callers control what gets rate
    /// limited by constructing the key from relevant data.
    fn check_and_increment(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> impl Future<Output = Result<RateLimitResult, Report>> + Send;
}

/// Port for notification persistence operations.
pub trait NotificationRepository {
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
        request: &SendNotificationRequest<'a, T>,
        notification_id: Uuid,
        service_sender: &str,
        recipient_ids: &[MacroUserIdStr<'a>],
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;

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

    /// Delete notifications matching the given criteria.
    ///
    /// Returns the number of notifications deleted.
    fn delete_notifications<'a>(
        &self,
        criteria: &RevokeCriteria<'a>,
    ) -> impl Future<Output = Result<u64, Report>> + Send;
}

/// Port for WebSocket delivery via connection gateway.
pub trait WebSocketSender {
    /// Send notifications to users via WebSocket.
    ///
    /// Returns the set of users who successfully received the notification
    /// (i.e., they were online and the message was delivered).
    fn send_notifications<'a, T: Notification + Send + Sync>(
        &self,
        notifications: Vec<(MacroUserIdStr<'a>, &T)>,
    ) -> impl Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Port for email delivery.
pub trait EmailSender {
    /// Send an email notification to a user.
    fn send_email<T: Notification + Send + Sync>(
        &self,
        notification: &T,
        recipient: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
