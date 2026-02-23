use notification::domain::models::Notification;
use notification::domain::models::rate_limit::{RateLimitConfig, RateLimitKey};
use serde::{Deserialize, Serialize};

/// A minimal notification type for sandbox testing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxNotification {
    /// A test message.
    pub message: String,
}

impl Notification for SandboxNotification {
    const TYPE_NAME: &'static str = "sandbox_notification";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

/// A notification type that will never match any real notification.
/// Used to create block/invite lists where nothing matches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeverMatchNotification;

impl Notification for NeverMatchNotification {
    const TYPE_NAME: &'static str = "__never__";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}
