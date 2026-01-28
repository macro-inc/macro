//! Domain models for the notification service.

use crate::domain::models::apple::APNSPushNotification;
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

/// Trait that all notification types must implement.
pub trait Notification: Serialize + DeserializeOwned + Send + Sync {
    /// The type name of this notification.
    const TYPE_NAME: &'static str;

    /// The user visible title of the notification.
    fn title(&self) -> String;
    /// The user visible body of the notification.
    fn body(&self) -> String;
    /// The configuration for how often the notification can be triggered on a certain key.
    fn rate_limit_config() -> Option<RateLimitConfig>;
    /// The actual key for the rate limit bucket.
    fn rate_limit_key(&self) -> Option<RateLimitKey>;
}

/// Trait for notifications that can build APNS push payloads.
pub trait BuildApnsNotification<T>: Notification {
    /// Build an APNS push notification from this notification.
    fn build_apns(&self) -> APNSPushNotification<T>;
}
