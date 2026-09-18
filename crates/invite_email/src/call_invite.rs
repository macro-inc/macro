use super::*;

/// An invitation to join a call directly, without creating a Macro account.
#[derive(Debug, Clone, Serialize, Deserialize, Template)]
#[template(path = "invite_to_call.html")]
pub struct CallInvite {
    /// The meeting's title.
    pub title: String,
    /// Validated, server-issued meeting capability.
    pub share_token: String,
    /// Sender of the invitation.
    pub invited_by: MacroUserIdStr<'static>,
    /// Destination email, included in the delivery rate-limit key.
    pub recipient_email: String,
}

impl CallInvite {
    fn join_url(&self) -> Url {
        let mut url = frontend_host(Environment::new_or_prod());
        url.set_path(&format!("/app/meet/{}", self.share_token));
        url
    }

    fn sender_display(&self) -> &str {
        self.invited_by.email_str()
    }
}

impl Notification for CallInvite {
    const TYPE_NAME: &'static str = "call_invite";
}

impl NotificationExtEmail for CallInvite {
    fn format_email(&self) -> EmailContent {
        EmailContent {
            subject: format!("{} invited you to {}", self.sender_display(), self.title),
            body: self.render().expect("CallInvite template must render"),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 1,
            window: Duration::from_mins(1),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::builder(&Self::TYPE_NAME)
            .append(&self.share_token)
            .append(&self.recipient_email)
            .finish()
    }
}
