//! Project collection and task read contracts.

use chrono::{DateTime, Utc};
#[cfg(feature = "ports")]
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{InitiativeDetail, InitiativeError, InitiativeSummary};

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

/// A project row with caller-specific permissions, properties and task progress.
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
    /// Number of tasks the project lists.
    pub task_count: u32,
    /// Number of listed tasks whose status is completed.
    pub completed_task_count: u32,
}

/// A live task in a project. Anyone who may view the project may list it;
/// opening it still needs the task's own access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectTask {
    /// The task's document id.
    pub id: String,
    /// Whether the task's status is Completed.
    pub completed: bool,
}

/// An authorized project with every live task it lists.
///
/// The project's View access authorizes listing its tasks, like a folder
/// lists its documents; no task is checked or opened here.
#[cfg(feature = "ports")]
#[derive(Debug, Clone)]
pub struct InitiativeRead {
    receipt: EntityAccessReceipt<ViewAccessLevel>,
    detail: InitiativeDetail,
    tasks: Vec<ProjectTask>,
}

#[cfg(feature = "ports")]
impl InitiativeRead {
    /// Pair a project receipt with its detail and the tasks it lists. The
    /// detail's `task_ids` are replaced by the tasks' ids.
    pub fn new(
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        mut detail: InitiativeDetail,
        tasks: Vec<ProjectTask>,
    ) -> Self {
        detail.task_ids = tasks.iter().map(|task| task.id.clone()).collect();
        Self {
            receipt,
            detail,
            tasks,
        }
    }

    /// Project detail with every task it lists.
    pub fn detail(&self) -> &InitiativeDetail {
        &self.detail
    }

    /// Take the project detail.
    pub fn into_detail(self) -> InitiativeDetail {
        self.detail
    }

    /// The project's View receipt, which authorizes listing its tasks.
    pub fn receipt(&self) -> &EntityAccessReceipt<ViewAccessLevel> {
        &self.receipt
    }

    /// The tasks the project lists, in the detail's order.
    pub fn tasks(&self) -> &[ProjectTask] {
        &self.tasks
    }
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

/// A page of the tasks a project lists, counted before paging.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct InitiativeTasksPage {
    /// Listed task ids; opening one still needs the task's own access.
    pub task_ids: Vec<String>,
    /// Continuation when another page exists.
    pub next_cursor: Option<String>,
    /// Total tasks the project lists.
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
