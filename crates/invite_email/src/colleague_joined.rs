use super::*;

const DISPLAY_NAME_MAX_CHARS: usize = 64;

/// Tells someone whose address matches a team's auto-join domain that a colleague joined Macro.
#[derive(Debug, Clone, Serialize, Deserialize, Template)]
#[template(path = "colleague_joined_macro.html")]
pub struct ColleagueJoinedMacro {
    /// The team the recipient joins automatically when they sign up.
    pub team_name: String,
    /// The colleague who joined Macro.
    pub joined_by: MacroUserIdStr<'static>,
    /// The colleague's display name from an untrusted source. It is shown on one line, capped,
    /// and escaped.
    pub joined_name: Option<String>,
    /// The address the recipient signs up with to join the team.
    pub recipient_email: EmailStr<'static>,
}

impl ColleagueJoinedMacro {
    fn display_name(&self) -> Option<String> {
        let words: Vec<&str> = self
            .joined_name
            .as_deref()?
            .split(|c: char| c.is_whitespace() || c.is_control())
            .filter(|word| !word.is_empty())
            .collect();
        let capped: String = words
            .join(" ")
            .chars()
            .take(DISPLAY_NAME_MAX_CHARS)
            .collect();
        let name = capped.trim_end();
        (!name.is_empty()).then(|| name.to_owned())
    }

    fn joined_display(&self) -> String {
        self.display_name()
            .unwrap_or_else(|| self.joined_email().to_owned())
    }

    fn joined_email(&self) -> &str {
        self.joined_by.email_str()
    }

    fn recipient(&self) -> &str {
        self.recipient_email.0.as_ref()
    }

    fn signup_url(&self) -> Url {
        signup_url(Environment::new_or_prod())
    }
}

impl Notification for ColleagueJoinedMacro {
    const TYPE_NAME: &'static str = "colleague_joined_macro";
}

impl NotificationExtEmail for ColleagueJoinedMacro {
    fn format_email(&self) -> EmailContent {
        EmailContent {
            subject: format!("{} joined Macro", self.joined_display()),
            body: self
                .render()
                .expect("ColleagueJoinedMacro template render failed in format_email"),
        }
    }

    fn rate_limit_config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 1,
            window: Duration::from_hours(24 * 365),
        }
    }

    fn rate_limit_key(&self) -> RateLimitKey {
        RateLimitKey::builder(&Self::TYPE_NAME)
            .append(&self.joined_by)
            .append(&self.recipient())
            .finish()
    }
}
