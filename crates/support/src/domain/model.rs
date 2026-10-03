use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("not found")]
    NotFound,
    #[error("not authorized")]
    Forbidden,
    #[error("rate limit reached")]
    RateLimited,
    #[error("support operation failed: {0}")]
    Internal(rootcause::Report),
}
pub type Result<T> = std::result::Result<T, Error>;
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::Internal(rootcause::report!(e).into())
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Open,
    InProgress,
    WaitingOnCustomer,
    WaitingOnTeam,
    Resolved,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Urgent,
    High,
    #[default]
    Medium,
    Low,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Manual,
    Widget,
    Email,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResponseMode {
    #[default]
    Draft,
    Automatic,
    Delayed,
    Confident,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub widget_key: Uuid,
    pub widget_enabled: bool,
    pub allowed_origins: Vec<String>,
    pub name: String,
    pub welcome: String,
    pub agent_enabled: bool,
    pub response_mode: ResponseMode,
    pub delay_minutes: u32,
    pub confidence_threshold: f64,
    pub system_prompt: String,
    pub knowledge: String,
    pub email_link_id: Option<Uuid>,
    pub support_email: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            widget_key: Uuid::new_v4(),
            widget_enabled: false,
            allowed_origins: vec![],
            name: "Support agent".into(),
            welcome: "Hi! How can we help?".into(),
            agent_enabled: false,
            response_mode: ResponseMode::Draft,
            delay_minutes: 5,
            confidence_threshold: 0.85,
            system_prompt: "Help customers using our public knowledge. Escalate when uncertain."
                .into(),
            knowledge: String::new(),
            email_link_id: None,
            support_email: None,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.len() > 100
            || self.welcome.len() > 2000
            || self.system_prompt.len() > 16000
            || self.knowledge.len() > 100000
            || !(1..=60).contains(&self.delay_minutes)
            || !self.confidence_threshold.is_finite()
            || !(0.5..=1.0).contains(&self.confidence_threshold)
            || self.allowed_origins.len() > 20
        {
            return Err(Error::Invalid("invalid Support settings".into()));
        }
        for origin in &self.allowed_origins {
            let u = url::Url::parse(origin).map_err(|_| {
                Error::Invalid("origins must be exact https://example.com origins".into())
            })?;
            if u.origin().ascii_serialization() != *origin
                || (u.scheme() != "https"
                    && !(u.scheme() == "http"
                        && matches!(u.host_str(), Some("localhost" | "127.0.0.1"))))
            {
                return Err(Error::Invalid(
                    "origins must be exact HTTPS origins (HTTP allowed for localhost)".into(),
                ));
            }
        }
        if self.email_link_id.is_some() != self.support_email.is_some()
            || self.support_email.as_ref().is_some_and(|s| !valid_email(s))
        {
            return Err(Error::Invalid(
                "choose a connected inbox and a valid support address".into(),
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSettings {
    pub team_id: Uuid,
    pub user_id: String,
    pub settings: Settings,
    pub email_cursor_at: DateTime<Utc>,
    pub email_cursor_id: Uuid,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Customer {
    pub email: String,
    pub name: String,
    pub contact_id: Option<Uuid>,
    pub company_id: Option<Uuid>,
    pub company_name: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAnswer {
    pub content: String,
    pub confidence: f64,
    pub handoff: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticket {
    pub id: Uuid,
    pub team_id: Uuid,
    pub channel_id: Uuid,
    pub subject: String,
    pub customer: Customer,
    pub status: Status,
    pub priority: Priority,
    pub assignee_id: Option<String>,
    pub source: Source,
    pub email_thread_id: Option<Uuid>,
    pub email_reply_id: Option<Uuid>,
    pub agent_paused: bool,
    pub draft: Option<AgentAnswer>,
    pub preview: String,
    pub last_customer_message_id: Option<Uuid>,
    pub last_customer_at: Option<DateTime<Utc>>,
    pub last_human_reply_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Author {
    Customer,
    Human,
    Agent,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub author_kind: Author,
    pub author_name: String,
    pub content: String,
    pub public: bool,
    pub email_message_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedTask {
    pub id: String,
    pub title: String,
    pub status: String,
}
/// Access-checked Task facts; Support decides whether they may be linked.
#[derive(Debug, Clone)]
pub struct TaskFacts {
    pub task: LinkedTask,
    pub shared_with_team: bool,
    pub team_id: Option<Uuid>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Detail {
    pub ticket: Ticket,
    pub messages: Vec<Message>,
    pub tasks: Vec<LinkedTask>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct NewTicket {
    pub subject: String,
    pub email: String,
    pub name: String,
    pub content: String,
}
#[derive(Debug, Clone, Deserialize, Default)]
pub struct TicketPatch {
    pub status: Option<Status>,
    pub priority: Option<Priority>,
    pub assignee_id: Option<String>,
    pub agent_paused: Option<bool>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Reply {
    pub id: Uuid,
    pub content: String,
    pub public: bool,
    #[serde(default)]
    pub mentions: Vec<serde_json::Value>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct TaskInput {
    pub task_id: Option<String>,
    pub title: Option<String>,
    #[serde(default)]
    pub description: String,
}
#[derive(Debug, Clone, Deserialize, Default)]
pub struct TicketFilter {
    pub company_id: Option<Uuid>,
    pub contact_id: Option<Uuid>,
    pub before: Option<DateTime<Utc>>,
    pub before_id: Option<Uuid>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inbox {
    pub id: Uuid,
    pub email: String,
}
#[derive(Debug, Clone)]
pub struct IncomingEmail {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub email: String,
    pub name: String,
    pub subject: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub struct Job {
    pub ticket_id: Uuid,
    pub trigger_id: Uuid,
    pub team_id: Uuid,
}
pub fn valid_email(s: &str) -> bool {
    let parts: Vec<_> = s.split('@').collect();
    s.len() <= 254
        && !s.chars().any(char::is_whitespace)
        && parts.len() == 2
        && !parts[0].is_empty()
        && parts[1].contains('.')
}
pub fn validate_content(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.len() > 32000 {
        Err(Error::Invalid("message must contain 1–32,000 bytes".into()))
    } else {
        Ok(())
    }
}
/// Strip internal rich references before content crosses the customer boundary.
pub fn public_content(s: &str) -> String {
    let mut rest = s;
    let mut out = String::new();
    while let Some(start) = rest.find("<m-") {
        out.push_str(&rest[..start]);
        out.push_str("[internal reference]");
        let tail = &rest[start..];
        let Some(end) = tail.find("</m-") else {
            return out;
        };
        let Some(close) = tail[end..].find('>') else {
            return out;
        };
        rest = &tail[end + close + 1..];
    }
    out.push_str(rest);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_origins() {
        let mut s = Settings::default();
        s.allowed_origins = vec!["https://acme.com".into()];
        assert!(s.validate().is_ok());
        for origin in [
            "https://acme.com/path",
            "https://acme.com/",
            "http://acme.com",
            "https://acme.com?x=1",
        ] {
            s.allowed_origins = vec![origin.into()];
            assert!(s.validate().is_err());
        }
        s.allowed_origins = vec!["http://localhost:4177".into()];
        assert!(s.validate().is_ok());
    }
    #[test]
    fn reference_privacy() {
        assert_eq!(
            public_content("Read <m-document id=\"secret\">roadmap</m-document> now"),
            "Read [internal reference] now"
        );
        assert_eq!(
            public_content("Hello <m-user broken secret"),
            "Hello [internal reference]"
        );
    }
    #[test]
    fn numeric_settings() {
        let mut s = Settings::default();
        s.confidence_threshold = f64::NAN;
        assert!(s.validate().is_err());
        s.confidence_threshold = 0.85;
        s.delay_minutes = 0;
        assert!(s.validate().is_err());
    }
    #[test]
    fn bounded_messages() {
        assert!(validate_content(" ").is_err());
        assert!(validate_content(&"a".repeat(32001)).is_err());
        assert!(validate_content("help").is_ok());
    }
}
