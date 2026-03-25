#![deny(missing_docs)]
//! Domain models for referral invitation notifications.
//!
//! Contains the [`InviteToMacro`] notification type and the [`ReferralCode`] newtype.

#[cfg(test)]
mod test;

use askama::Template;
use macro_env::Environment;
use macro_user_id::email::EmailStr;
use notification::domain::models::{
    Notification, NotificationExtEmail, RateLimitConfig, RateLimitKey, queue_message::EmailContent,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

/// Wrapper for the referral code to make it type safe
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ReferralCode(pub String);

/// The metadata for a referral-to-macro notification.
#[derive(Debug, Serialize, Deserialize, Clone, Template)]
#[template(path = "invite.html")]
pub struct InviteToMacro {
    /// The recipient email.
    pub recipient_email: EmailStr<'static>,
    /// The referral code which is templated into the email to track the sender
    /// and reward them.
    pub referral_code: ReferralCode,
    /// The sender's profile picture URL, if available.
    pub sender_profile_picture_url: Option<String>,
    /// The sender's display name, if they have set one.
    pub sender_name: Option<String>,
    /// The sender's email address.
    #[serde(default)]
    pub sender_email: Option<String>,
}

impl InviteToMacro {
    fn referral_url(&self) -> Url {
        let env = Environment::new_or_prod();
        get_url(env, &self.referral_code)
    }
}

impl Notification for InviteToMacro {
    const TYPE_NAME: &'static str = "invite_to_macro";
}

const MINUTES_PER_WEEK: u64 = 60 * 24 * 7;

fn get_url(env: Environment, code: &ReferralCode) -> Url {
    let host = match env {
        Environment::Production => "https://macro.com",
        Environment::Develop => "https://dev.macro.com",
        Environment::Local => "http://localhost:3000",
    };
    let mut url = Url::parse(host).expect("all the inputs are static, valid values");
    url.set_path("/app/signup");
    url.query_pairs_mut()
        .clear()
        .append_pair("referral_code", &code.0)
        .finish();
    url
}

impl NotificationExtEmail for InviteToMacro {
    fn format_email(&self) -> EmailContent {
        let sender = self
            .sender_name
            .as_deref()
            .or(self.sender_email.as_deref())
            .unwrap_or("A Macro user");
        EmailContent {
            subject: format!("{} has invited you to join Macro", sender),
            body: self
                .render()
                .expect("InviteToMacro template render failed in format_email"),
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
