//! A source-neutral snapshot of projects and issues, retained in the import ledger.

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// A source identifier, safe to use as a URL path segment.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct ObjectId(String);

impl ObjectId {
    /// Validate a provider id or a namespaced Jira id.
    pub fn parse(value: impl Into<String>) -> Result<Self, TrackerError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 256
            || !value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_:".contains(&c))
        {
            return Err(TrackerError::Decode("invalid source identifier".into()));
        }
        Ok(Self(value))
    }

    /// Provider identity.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for ObjectId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// The kind of grouping in an issue tracker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupKind {
    /// A Linear team.
    Team,
    /// A Linear initiative.
    Initiative,
    /// A Linear or Jira project.
    Project,
    /// A Jira epic, also represented as a task when it has content.
    Epic,
}

/// A collection whose issues become tasks in a Macro project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// Stable provider identity.
    pub id: ObjectId,
    /// Display title.
    pub title: String,
    /// Provider grouping type.
    pub kind: GroupKind,
    /// Parent grouping, when available.
    pub parent: Option<ObjectId>,
    /// Source URL.
    pub url: Option<String>,
    /// Markdown description.
    pub description: Option<String>,
}

/// A provider member. Email may be hidden by the provider's privacy settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// Stable provider identity.
    pub id: ObjectId,
    /// Display name.
    pub name: String,
    /// Visible email address.
    pub email: Option<String>,
}

/// A cycle associated with Linear issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cycle {
    /// Stable provider identity.
    pub id: ObjectId,
    /// Display name or cycle number.
    pub name: String,
    /// Owning team.
    pub team: ObjectId,
}

/// A source comment retained in the task body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    /// Stable comment id.
    pub id: ObjectId,
    /// Display author.
    pub author: String,
    /// Markdown comment body.
    pub body: String,
    /// Source timestamp, when exposed.
    pub created_at: Option<String>,
}

/// A complete issue ready for planning without further provider requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Stable provider identity, namespaced by Jira site where needed.
    pub id: ObjectId,
    /// Human-readable key.
    pub identifier: String,
    /// Task title.
    pub title: String,
    /// Markdown body.
    pub description: String,
    /// Workflow status name.
    pub status: String,
    /// Stable status category (Linear type or Jira category key).
    pub status_category: String,
    /// Source issue type.
    pub issue_type: Option<String>,
    /// Priority label.
    pub priority: Option<String>,
    /// Visible assignee email, matched only against the Macro team.
    pub assignee_email: Option<String>,
    /// ISO date.
    pub due_date: Option<String>,
    /// Source labels.
    pub labels: Vec<String>,
    /// Estimate in source units.
    pub estimate: Option<f64>,
    /// Parent issue.
    pub parent: Option<ObjectId>,
    /// Owning project or epic.
    pub group: Option<ObjectId>,
    /// Owning team.
    pub team: Option<ObjectId>,
    /// Cycle identity.
    pub cycle: Option<ObjectId>,
    /// Original issue URL.
    pub url: String,
    /// All readable comments.
    pub comments: Vec<Comment>,
}

/// All readable objects in the requested workspace.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Inventory {
    /// Teams, initiatives, projects and epics.
    pub groups: Vec<Group>,
    /// Issues, including sub-issues.
    pub issues: Vec<Issue>,
    /// Visible workspace members.
    pub users: Vec<User>,
    /// Linear cycles.
    pub cycles: Vec<Cycle>,
    /// Optional features or unreadable items omitted, with an explanation.
    pub warnings: Vec<String>,
}

/// Source API and transport errors.
#[derive(Debug, thiserror::Error)]
pub enum TrackerError {
    /// The connection is disabled or missing.
    #[error("The issue tracker is not connected")]
    NotConnected,
    /// The source denied access.
    #[error("The issue tracker denied access ({0})")]
    Forbidden(u16),
    /// A malformed response or stalled cursor.
    #[error("Invalid issue tracker response: {0}")]
    Decode(String),
    /// The source rejected the fixed read request.
    #[error("Issue tracker request failed ({status}): {message}")]
    Upstream {
        /// HTTP status, or 200 for GraphQL errors.
        status: u16,
        /// Bounded provider explanation.
        message: String,
    },
    /// Pipedream or connection store error.
    #[error("Issue tracker transport failed: {0}")]
    Transport(rootcause::Report),
}

/// Read a user's tracker. Object-safe so the durable engine can host sources
/// without adding a type parameter for every connected app.
#[async_trait]
pub trait TrackerConnections: Send + Sync + 'static {
    /// Inventory through the user's enabled grant, reporting discovered counts.
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(usize, usize) + Send + Sync),
    ) -> Result<Inventory, TrackerError>;
}
