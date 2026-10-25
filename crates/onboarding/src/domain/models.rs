//! Pure data model for the onboarding flow.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Lifecycle of the onboarding flow itself.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OnboardingStatus {
    /// The user is (or can be sent) through the onboarding flow.
    Active,
    /// The user finished or skipped onboarding; never show the flow again.
    Completed,
}

/// One user's onboarding row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct OnboardingRow {
    /// Where the flow is in its lifecycle.
    pub status: OnboardingStatus,
    /// Whether the user skipped rather than finished.
    pub skipped: bool,
    /// When the flow was first touched.
    pub started_at: DateTime<Utc>,
    /// When the flow completed, if it has.
    pub completed_at: Option<DateTime<Utc>>,
}

/// One of the user's MCP server connections, as the setup page sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ConnectedServer {
    /// The server's display name.
    pub name: String,
    /// The server URL.
    pub url: String,
    /// Whether the user has completed OAuth against it.
    pub authenticated: bool,
}

/// The onboarding aggregate served to the setup page. Import runs and
/// staged entities are served separately by `GET /import/state`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct OnboardingState {
    /// The user's onboarding row.
    pub row: OnboardingRow,
    /// The user's MCP server connections.
    pub connected_servers: Vec<ConnectedServer>,
    /// The account email's domain when it can back a domain team — i.e. it
    /// is not a generic consumer provider — `None` otherwise. Judged with
    /// the same list the teams service uses for domain auto-join and
    /// claiming, so the client never suggests a domain team the server
    /// would refuse.
    pub suggested_team_domain: Option<String>,
}

/// A sidebar prompt (setup or import card) the client can dismiss: 1–64
/// lowercase letters, digits, `:`, `_`, or `-`, starting alphanumerically.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PromptId(String);

impl PromptId {
    /// Validate a client-supplied prompt id. `None` when it is malformed.
    pub fn parse(raw: &str) -> Option<Self> {
        let mut chars = raw.chars();
        let valid = raw.len() <= 64
            && chars
                .next()
                .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && chars.all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, ':' | '_' | '-')
            });
        valid.then(|| Self(raw.to_owned()))
    }
}

impl AsRef<str> for PromptId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// The prompts the user dismissed, on any device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DismissedPrompts {
    /// Dismissed prompt ids, oldest dismissal first.
    pub dismissed: Vec<String>,
}
