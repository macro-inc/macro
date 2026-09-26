//! Project collection and task-reference read contracts.

use chrono::{DateTime, Utc};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{InitiativeId, InitiativeSummary};

/// Snapshot of canonical property values, never a second writable store.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativePropertySnapshot {
    /// Status option id, or unset.
    pub status: Option<Uuid>,
    /// Priority option id, or unset.
    pub priority: Option<Uuid>,
    /// Assigned user ids, independent of sharing membership.
    pub assignees: Vec<String>,
    /// Due timestamp, or unset.
    pub due_date: Option<DateTime<Utc>>,
    /// Whether the canonical task status represents completion.
    pub completed: bool,
}

/// Supported collection ordering. Every ordering uses id as its final tie breaker.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum InitiativeSort {
    /// Last update time.
    #[default]
    Updated,
    /// Case-insensitive name.
    Name,
    /// Due date, with unset dates last.
    Due,
}

/// Filters are applied before cursor pagination.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::IntoParams, utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativePageRequest {
    /// Maximum rows, between one and one hundred; defaults to fifty.
    pub limit: Option<u16>,
    /// Opaque continuation returned by the previous page.
    pub cursor: Option<String>,
    /// Case-insensitive name substring.
    pub query: Option<String>,
    /// Required status option id.
    pub status: Option<Uuid>,
    /// Required priority option id.
    pub priority: Option<Uuid>,
    /// Required assignee user id.
    pub assignee: Option<String>,
    /// Inclusive due-date lower bound.
    pub due_after: Option<DateTime<Utc>>,
    /// Inclusive due-date upper bound.
    pub due_before: Option<DateTime<Utc>>,
    /// Sort key; defaults to updated time.
    #[serde(default)]
    pub sort: InitiativeSort,
    /// Descending order; defaults to true for updated time.
    pub descending: Option<bool>,
}

/// A project row with caller-specific permissions, properties and visible task progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativePageRow {
    /// Existing initiative identity and timestamps.
    #[serde(flatten)]
    pub initiative: InitiativeSummary,
    /// Verified effective access for the caller.
    pub user_access_level: AccessLevel,
    /// Canonical property values.
    pub properties: InitiativePropertySnapshot,
    /// Number of associated tasks the caller may view.
    pub task_count: u32,
    /// Number of visible tasks whose status is completed.
    pub completed_task_count: u32,
}

/// One authorized project collection page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativePage {
    /// Rows in requested order.
    pub initiatives: Vec<InitiativePageRow>,
    /// Continuation, absent when exhausted.
    pub next_cursor: Option<String>,
}

/// Task page inputs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::IntoParams, utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeTasksRequest {
    /// Maximum rows, one through one hundred.
    pub limit: Option<u16>,
    /// Last task id returned by the preceding page.
    pub cursor: Option<String>,
}

/// Visible tasks with visibility applied before paging and counting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeTasksPage {
    /// Visible task ids; hydrate through existing task reads.
    pub task_ids: Vec<String>,
    /// Continuation when another visible page exists.
    pub next_cursor: Option<String>,
    /// Total associated tasks visible to the caller.
    pub total: u32,
}

/// Bounded batch of task ids to resolve.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TaskInitiativeReferencesRequest {
    /// At most one hundred distinct task ids.
    pub task_ids: Vec<String>,
}

/// Minimal project display reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct InitiativeReference {
    /// Project id.
    pub id: InitiativeId,
    /// Authorized project name.
    pub name: String,
}

/// A task's project. An inaccessible project never exposes its id or name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskInitiativeReference {
    /// The visible task has no project.
    None {
        /// Task id.
        #[serde(rename = "taskId")]
        task_id: String,
    },
    /// The task or its project is not visible to the caller.
    Unavailable {
        /// Requested task id, with no inaccessible metadata.
        #[serde(rename = "taskId")]
        task_id: String,
    },
    /// Both task and project are visible.
    Visible {
        /// Task id.
        #[serde(rename = "taskId")]
        task_id: String,
        /// Authorized project reference.
        initiative: InitiativeReference,
    },
}

/// Task references in deduplicated request order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct TaskInitiativeReferences {
    /// Per-task visibility-aware references.
    pub references: Vec<TaskInitiativeReference>,
}

#[cfg(all(test, feature = "inbound"))]
mod test;
