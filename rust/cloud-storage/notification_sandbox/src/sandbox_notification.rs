use email_formatting::EmailDigestNotification;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::APNSPushNotification;
use notification::domain::models::mobile::NotifCollapseKey;
use notification::domain::models::queue_message::EmailContent;
use notification::domain::models::rate_limit::{RateLimitConfig, RateLimitKey};
use notification::domain::models::{Notification, NotificationExtEmail, NotificationExtIos};
use serde::{Deserialize, Serialize};

/// A minimal notification type for sandbox testing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxNotification {
    /// A test message.
    pub inner: EmailDigestNotification,
}

impl Notification for SandboxNotification {
    const TYPE_NAME: &'static str = "email-digest-notification";
}

impl NotificationExtIos for SandboxNotification {
    type NotifData = SandboxNotification;

    fn collapse_key(&self, _entity: &model_entity::Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new("sandbox")
    }

    fn as_apns<'a>(
        &self,
        _sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &model_entity::Entity<'_>,
        _notification_id: uuid::Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(APNSPushNotification {
            aps: Default::default(),
            push_notification_data: self.clone(),
        })
    }
}

impl NotificationExtEmail for SandboxNotification {
    fn format_email(&self) -> EmailContent {
        self.inner.format_email()
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig::new(u64::MAX, std::time::Duration::from_secs(3600))
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::from_str_hashed(&"sandbox")
    }
}

/// A notification type that will never match any real notification.
/// Used to create block/invite lists where nothing matches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeverMatchNotification;

impl Notification for NeverMatchNotification {
    const TYPE_NAME: &'static str = "__never__";
}
