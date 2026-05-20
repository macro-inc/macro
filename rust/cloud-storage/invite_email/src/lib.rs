#![deny(missing_docs)]
//! Domain models for invitation email notifications.
//!
//! Contains the [`InviteToMacro`] referral notification, the [`InviteToTeamMetadata`] team
//! invitation notification, the [`ChannelInviteMetadata`] channel invitation, and the
//! [`ReferralCode`] newtype.

#[cfg(test)]
mod test;

use askama::Template;
use macro_env::Environment;
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::EmailStr;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtEmail, NotificationExtIos, NotificationTitle,
    RateLimitConfig, RateLimitKey,
    apple::{APNSPushNotification, AlertDictionary, Aps, PushNotificationData},
    queue_message::EmailContent,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;
use utoipa::ToSchema;
use uuid::Uuid;

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
    pub sender_profile_picture_url: Option<Url>,
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

fn frontend_host(env: Environment) -> Url {
    let host = match env {
        Environment::Production => "https://macro.com".to_string(),
        Environment::Develop => "https://dev.macro.com".to_string(),
        Environment::Local => {
            let port = std::env::var("FRONTEND_PORT").unwrap_or_else(|_| "3000".to_string());
            format!("http://localhost:{port}")
        }
    };

    Url::parse(&host).expect("all the inputs are static, valid values")
}

fn signup_url(env: Environment) -> Url {
    let mut url = frontend_host(env);
    url.set_path("/app/signup");
    url
}

fn get_url(env: Environment, code: &ReferralCode) -> Url {
    let mut url = signup_url(env);
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

/// Metadata for when a user is invited to a channel.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, Template)]
#[serde(rename_all = "camelCase")]
#[template(path = "invite_to_channel.html")]
pub struct ChannelInviteMetadata {
    /// The user who sent the invitation
    #[serde(alias = "invited_by")]
    #[schema(value_type = String)]
    pub invited_by: MacroUserIdStr<'static>,
    /// The name of the channel
    #[serde(default)]
    #[serde(alias = "channel_name")]
    pub channel_name: String,
    /// Message content to show in the invite email, when the invite was triggered by a message.
    #[serde(default)]
    pub message_content: Option<String>,
    /// The sender's profile picture URL, if available.
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl ChannelInviteMetadata {
    fn signup_url(&self) -> Url {
        signup_url(Environment::new_or_prod())
    }

    fn sender_display(&self) -> &str {
        self.invited_by.email_str()
    }
}

impl Notification for ChannelInviteMetadata {
    const TYPE_NAME: &'static str = "channel_invite";
}

impl NotificationTitle for ChannelInviteMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let email = self.invited_by.email_part();
        let sender = email.email_str();
        Ok(format!(
            "{sender} invited you to join #{}",
            self.channel_name
        ))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok("Open macro to continue".to_string())
    }
}

impl NotificationExtEmail for ChannelInviteMetadata {
    fn format_email(&self) -> EmailContent {
        let sender = self.sender_display();
        EmailContent {
            subject: format!("{sender} has invited you to join #{}", self.channel_name),
            body: self
                .render()
                .expect("ChannelInviteMetadata template render failed in format_email"),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 1,
            window: Duration::from_hours(24 * 7),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::builder(&Self::TYPE_NAME)
            .append(&self.invited_by)
            .append(&self.channel_name)
            .finish()
    }
}

impl NotificationExtIos for ChannelInviteMetadata {
    type NotifData = PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let title = self
            .format_title(sender_id.as_ref().map(CowLike::copied))
            .ok()?;
        let body = self.format_body(sender_id).ok()?;
        let mutable_content = self.sender_profile_picture_url.as_ref().map(|_| 1);
        Some(APNSPushNotification {
            aps: Aps {
                alert: Some(notification::domain::models::apple::Alert::Dictionary(
                    AlertDictionary {
                        title: Some(title),
                        body: Some(body),
                        ..Default::default()
                    },
                )),
                mutable_content,
                ..Default::default()
            },
            push_notification_data: PushNotificationData {
                notification_id,
                sender_profile_picture_url: self.sender_profile_picture_url.clone(),
            },
        })
    }
}

/// Metadata for when a user is invited to a team.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, Template)]
#[serde(rename_all = "camelCase")]
#[template(path = "invite_to_team.html")]
pub struct InviteToTeamMetadata {
    /// The name of the team being invited to
    #[serde(alias = "team_name")]
    pub team_name: String,
    /// The unique identifier of the team
    #[serde(alias = "team_id")]
    pub team_id: Uuid,
    /// The unique identifier of the team invite
    #[serde(alias = "team_invite_id")]
    pub team_invite_id: Uuid,
    /// The user who sent the invitation
    #[serde(alias = "invited_by")]
    #[schema(value_type = String)]
    pub invited_by: MacroUserIdStr<'static>,
    /// Role/permission level in the team
    pub role: Option<String>,

    /// The sender's profile picture URL, if available.
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub sender_profile_picture_url: Option<Url>,
}

impl InviteToTeamMetadata {
    /// Returns the team invite URL for the current environment.
    pub fn invite_url(&self) -> Url {
        let env = Environment::new_or_prod();

        let mut url = frontend_host(env);
        url.set_path("/app/team-invite");
        url.query_pairs_mut()
            .append_pair("id", &self.team_invite_id.to_string());

        url
    }
}

impl Notification for InviteToTeamMetadata {
    const TYPE_NAME: &'static str = "invite_to_team";
}

impl NotificationExtEmail for InviteToTeamMetadata {
    fn format_email(&self) -> EmailContent {
        EmailContent {
            subject: format!(
                "{} has invited you to the {} team on Macro",
                self.invited_by.as_ref(),
                self.team_name
            ),
            body: self
                .render()
                .expect("InviteToTeamMetadata template render failed in format_email"),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        const HOURS_PER_WEEK: u64 = 24 * 7;
        RateLimitConfig {
            max_count: 1,
            window: Duration::from_hours(HOURS_PER_WEEK),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::builder(&Self::TYPE_NAME)
            .append(&self.team_id)
            .append(&self.invited_by.as_ref())
            .finish()
    }
}
