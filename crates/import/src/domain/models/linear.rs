//! Typed reads of a user's Linear issues, as discovery consumes them.

use chrono::{DateTime, NaiveDate, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The category of a Linear workflow state. Teams name their states freely;
/// the type is the stable meaning status mapping keys on.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum LinearStateType {
    /// Awaiting triage.
    Triage,
    /// In the backlog.
    Backlog,
    /// Planned but not started.
    Unstarted,
    /// In progress (including review states).
    Started,
    /// Done.
    Completed,
    /// Canceled or duplicate.
    Canceled,
    /// A type this importer does not know.
    #[serde(other)]
    Other,
}

impl LinearStateType {
    /// Whether the issue is still open work.
    pub fn is_open(self) -> bool {
        !matches!(self, Self::Completed | Self::Canceled)
    }
}

/// A Linear workflow state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearState {
    /// The team's name for the state (e.g. `In Review`).
    pub name: String,
    /// The state's category.
    pub kind: LinearStateType,
}

/// One Linear issue, as read from the API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearIssue {
    /// Stable issue id (a UUID).
    pub id: String,
    /// Human identifier (e.g. `ENG-142`).
    pub identifier: String,
    /// Title.
    pub title: String,
    /// Markdown description, when set.
    pub description: Option<String>,
    /// Deep link to the issue.
    pub url: String,
    /// Linear's priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    pub priority: u8,
    /// Due date, when set.
    pub due_date: Option<NaiveDate>,
    /// Last update time.
    pub updated_at: DateTime<Utc>,
    /// Whether the issue is archived.
    pub archived: bool,
    /// Current workflow state.
    pub state: LinearState,
}
