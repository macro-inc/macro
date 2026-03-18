//! This crate provides the mechanisms for sending referal code email notifications
//! To prospective users of macro.

use crate::domain::models::ReferralCode;
use macro_user_id::email::EmailStr;
use notification::domain::models::{
    Notification, NotificationExtEmail, RateLimitConfig, RateLimitKey, queue_message::EmailContent,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// the metadata for a referal to macro notification
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct InviteToMacro {
    /// the recipient email
    pub(crate) recipient_email: EmailStr<'static>,
    /// the refereral code which is templated into the email to track the sender
    /// and reward them
    pub(crate) referral_code: ReferralCode,
}

impl Notification for InviteToMacro {
    const TYPE_NAME: &'static str = "invite_to_macro";
}

const MINUTES_PER_WEEK: u64 = 60 * 24 * 7;

impl NotificationExtEmail for InviteToMacro {
    fn format_email(&self) -> EmailContent {
        EmailContent {
            subject: "You have been invited to join Macro".to_string(),
            body: "Temporary email body placeholder".to_string(),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        // 1 invite email per user per week
        RateLimitConfig {
            max_count: 1,
            window: Duration::from_mins(MINUTES_PER_WEEK),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::builder(&Self::TYPE_NAME)
            .append(&self.recipient_email.0.as_ref())
            .finish()
    }
}
