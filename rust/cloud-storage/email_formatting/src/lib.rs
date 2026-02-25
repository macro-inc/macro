use std::time::Duration;

use askama::Template;
use chrono::{DateTime, Utc};
use model_notifications::NotifEvent;
use notification::domain::models::{
    Notification, NotificationExtEmail, RateLimitConfig, RateLimitKey, UserNotificationRow,
    email_notification_digest::ports::DigestBatch, queue_message::EmailContent,
};
use rootcause::Report;
use serde::{Deserialize, Serialize};

#[derive(Template)]
#[template(path = "digest.html")]
struct DigestTemplate {
    notifs: Vec<NotifPreview>,
}

struct NotifPreview {
    created_at: DateTime<Utc>,
    message: String,
}

impl NotifPreview {
    fn new(v: UserNotificationRow<NotifEvent>) -> Option<Self> {
        Some(NotifPreview {
            created_at: v.created_at.unwrap_or(Utc::now()),
            message: format!(
                "PLACEHOLDER: you received a notification with typename {}",
                v.notification_event_type
            ),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailDigestNotification {
    /// the templated html string of the email
    inner_html_string: String,
    /// the subject line of the notification
    subject: String,
}

impl EmailDigestNotification {
    pub fn new_from_digest_batch(digest: DigestBatch) -> Result<Self, Report> {
        let DigestBatch {
            user_id: _,
            notifications,
            ..
        } = digest;

        fn log_err<E: std::fmt::Debug>(e: &E) {
            tracing::warn!("{e:?}");
        }

        let notifs: Vec<_> = notifications
            .into_iter()
            .map(|v| v.deserialize_metadata::<NotifEvent>())
            .filter_map(|res| res.inspect_err(log_err).ok())
            .filter_map(NotifPreview::new)
            .collect();

        let templated_len = notifs.len();

        let template = DigestTemplate { notifs };

        let inner_html_string = template.render()?;

        Ok(EmailDigestNotification {
            inner_html_string,
            subject: format!("You have {} new notifications on Macro", templated_len),
        })
    }
}

impl Notification for EmailDigestNotification {
    const TYPE_NAME: &'static str = "email-digest-notification";
}

impl NotificationExtEmail for EmailDigestNotification {
    fn format_email(&self) -> EmailContent {
        EmailContent {
            subject: self.subject.clone(),
            body: self.inner_html_string.clone(),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 60,
            window: Duration::from_hours(1),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        // NB: this key is currently intentionally shared across all users out of an abundance of caution to limit over-sending on SES
        RateLimitKey::from_str_hashed(Self::TYPE_NAME)
    }
}
