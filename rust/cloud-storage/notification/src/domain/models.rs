//! Domain models for the notification service.

use serde::{Serialize, de::DeserializeOwned};

pub(crate) mod android;
pub(crate) mod apple;
pub(crate) mod mobile;
pub(crate) mod queue_message;
pub mod rate_limit;
pub mod recipient;
pub mod request;

pub use mobile::DeviceEndpoint;
pub use rate_limit::{RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult};
pub use recipient::{ExclusionReason, FilteredRecipient, RecipientExclusion};
pub use request::{NotificationResult, SendNotificationRequest, SendNotificationRequestBuilder};

use crate::domain::models::{
    apple::APNSPushNotification, mobile::MessageAttributes, queue_message::EmailContent,
};

/// Notification ID paired with its APNS collapse key, for push clearing.
#[derive(Debug, Clone)]
pub struct NotificationIdAndCollapseKey {
    /// The notification ID.
    pub id: uuid::Uuid,
    /// The APNS collapse key used to identify the push notification to clear.
    pub apns_collapse_key: String,
}

/// Trait that all notification types must implement.
pub trait Notification: Serialize + DeserializeOwned + Send + Sync {
    /// The type name of this notification.
    const TYPE_NAME: &'static str;

    /// The configuration for how often the notification can be triggered on a certain key.
    fn rate_limit_config() -> Option<RateLimitConfig>;
    /// The actual key for the rate limit bucket.
    fn rate_limit_key(&self) -> Option<RateLimitKey>;
}

/// Extension trait for notifications that can be delivered via email.
pub trait NotificationExtEmail: Notification {
    /// Convert this notification into email content.
    fn into_email(self) -> EmailContent;
}

/// Extension trait for notifications that can be delivered via iOS push (APNS).
pub trait NotificationExtIos: Notification {
    /// The custom data type included in the APNS push notification payload.
    type NotifData: Send;
    /// Get the message attributes for this push notification.
    fn message_attributes(&self) -> MessageAttributes;
    /// Convert this notification into an APNS push notification.
    fn into_apns(self) -> Option<APNSPushNotification<Self::NotifData>>;
}
