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
}
