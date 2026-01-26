//! Domain models for the notification service.

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::models::apple::APNSPushNotification;

pub(crate) mod android;
pub(crate) mod apple;
pub(crate) mod mobile;
pub(crate) mod queue_message;
pub mod rate_limit;
pub mod recipient;
pub mod request;

pub use mobile::DeviceEndpoint;
pub use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult};
pub use recipient::{ExclusionReason, FilteredRecipients, RecipientExclusion};
pub use request::{DeliveryStatus, NotificationResult, RevokeCriteria, SendNotificationRequest};

#[derive(Debug, Serialize, Deserialize)]
struct NotificationPayload<'a, T> {
    /// some arbitraty T which implements [Notification]
    notification: T,
    /// the entity for which the notification is associated
    notification_entity: Entity<'a>,
    /// the sender id of the user
    sender: Option<MacroUserIdStr<'a>>,
    /// the recipient ids of the notification
    recipients: Vec<MacroUserIdStr<'a>>,
}

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

struct MobileNotification<'a, T> {
    payload: NotificationPayload<'a, T>,
    device_endpoint: DeviceEndpoint,
}
