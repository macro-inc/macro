//! Project collection, task-reference and preview read contracts.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{InitiativeDetail, InitiativeError, InitiativeId, InitiativeSummary};

const DEFAULT_PAGE_SIZE: u16 = 50;
const MAX_PAGE_SIZE: u16 = 100;
pub(super) const MAX_CURSOR_LENGTH: usize = 2048;

pub(super) fn page_size(limit: Option<u16>) -> Result<usize, InitiativeError> {
    let size = limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&size) {
        return Err(InitiativeError::BadRequest(
            "limit must be between 1 and 100".into(),
        ));
    }
    Ok(usize::from(size))
}

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

impl InitiativeTasksRequest {
    pub(crate) fn validate(&self) -> Result<usize, InitiativeError> {
        let size = page_size(self.limit)?;
        if self
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > MAX_CURSOR_LENGTH)
        {
            return Err(InitiativeError::BadRequest("invalid cursor".into()));
        }
        Ok(size)
    }
}

impl InitiativeDetail {
    /// Page task IDs already filtered by `InitiativeService::get`, without another access scan.
    pub fn task_page(
        &self,
        request: InitiativeTasksRequest,
    ) -> Result<InitiativeTasksPage, InitiativeError> {
        let size = request.validate()?;
        let total = u32::try_from(self.task_ids.len()).unwrap_or(u32::MAX);
        let mut ids = self.task_ids.clone();
        ids.sort();
        if let Some(cursor) = request.cursor {
            ids.retain(|id| id > &cursor);
        }
        let has_more = ids.len() > size;
        ids.truncate(size);
        let next_cursor = has_more.then(|| ids.last().cloned()).flatten();
        Ok(InitiativeTasksPage {
            task_ids: ids,
            next_cursor,
            total,
        })
    }
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

/// Most distinct initiative ids one preview request may resolve.
pub const MAX_PREVIEW_IDS: usize = 100;

/// Bounded batch of initiative ids to preview, such as the projects mentioned in a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativePreviewsRequest {
    /// At most one hundred initiative ids, each one to 128 bytes long.
    pub initiative_ids: Vec<String>,
}

/// Viewer-relative preview of one requested initiative. Only a viewable initiative
/// exposes its name and owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InitiativePreview {
    /// The caller can view the initiative.
    Access {
        /// Requested initiative id.
        id: String,
        /// Display name.
        name: String,
        /// Owner of the initiative.
        #[serde(rename = "ownerId")]
        owner_id: MacroUserIdStr<'static>,
    },
    /// The initiative exists, but the caller cannot view it.
    NoAccess {
        /// Requested initiative id.
        id: String,
    },
    /// No initiative has the requested id.
    DoesNotExist {
        /// Requested initiative id.
        id: String,
    },
}

/// Previews in deduplicated request order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct InitiativePreviews {
    /// One preview per distinct requested id.
    pub previews: Vec<InitiativePreview>,
}

#[cfg(all(test, feature = "inbound"))]
mod test;
