use askama::Template;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use model_notifications::{NotifEvent, NotificationTitle};
use notification::domain::models::{
    Notification, NotificationExtEmail, RateLimitConfig, RateLimitKey, UserNotificationRow,
    email_notification_digest::ports::DigestBatch, queue_message::EmailContent,
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Template)]
#[template(path = "digest.html")]
struct DigestTemplate {
    notifs: Vec<NotifPreview>,
    num_truncated: usize,
    total_count: usize,
}

struct NotifPreview {
    created_at: DateTime<Utc>,
    title: String,
    body: String,
}

const TRUNCATE_LEN: usize = 15;

impl NotifPreview {
    #[tracing::instrument(err)]
    fn new(v: UserNotificationRow<NotifEvent>) -> Result<Self, Report> {
        let title = v
            .notification_metadata
            .format_title(v.sender_id.as_ref().map(CowLike::copied))?;
        let body = v.notification_metadata.format_body(v.sender_id)?;
        Ok(NotifPreview {
            created_at: v.created_at.unwrap_or(Utc::now()),
            title,
            body,
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

        let input_len = notifications.len();

        fn log_err<E: std::fmt::Debug>(e: &E) {
            tracing::warn!("{e:?}");
        }

        let notifs: Vec<_> = notifications
            .into_iter()
            .map(|v| v.deserialize_metadata::<NotifEvent>())
            .filter_map(|res| res.inspect_err(log_err).ok())
            .map(NotifPreview::new)
            .filter_map(Result::ok)
            .take(TRUNCATE_LEN)
            .collect();

        let preview_len = notifs.len();
        let num_truncated = input_len - preview_len;

        let inner_html_string = DigestTemplate {
            notifs,
            num_truncated,
            total_count: input_len,
        }
        .render()?;

        Ok(EmailDigestNotification {
            inner_html_string,
            subject: format!("You have {input_len} new notifications on Macro"),
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
            max_count: 600,
            window: Duration::from_hours(1),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        // NB: this key is currently intentionally shared across all users out of an abundance of caution to limit over-sending on SES
        RateLimitKey::from_str_hashed(&Self::TYPE_NAME)
    }
}
