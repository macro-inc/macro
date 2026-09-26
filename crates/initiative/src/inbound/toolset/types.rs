//! Typed results optimized for project workflows.

use crate::domain::{models::InitiativeDetail, reads::InitiativePropertySnapshot};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

/// Current project state, including visibility-filtered task membership.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetails {
    /// Project id; use entity type `initiative` in property tools.
    pub initiative_id: Uuid,
    /// Project name.
    pub name: String,
    /// Description document; read or edit its Markdown using document tools.
    pub description_document_id: Uuid,
    /// Project owner.
    pub owner_id: String,
    /// Collaboration members, distinct from property assignees.
    pub member_ids: Vec<String>,
    /// Up to 200 associated tasks the caller can view.
    pub task_ids: Vec<String>,
    /// Total associated tasks the caller can view.
    pub task_count: usize,
    /// Whether the project contains additional visible tasks beyond taskIds.
    pub tasks_truncated: bool,
    /// Caller's effective permission.
    pub access: String,
    /// Explicit owner-team access, or absent when off.
    pub team_access: Option<String>,
    /// Link scope: PUBLIC or TEAM, or absent when off.
    pub link_scope: Option<String>,
    /// Access granted by the link.
    pub link_access: Option<String>,
    /// Explicit channel shares.
    pub channel_shares: Vec<ProjectChannelShare>,
}

/// One channel's explicit project grant.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelShare {
    /// Shared channel identifier.
    pub channel_id: String,
    /// Granted access level.
    pub access: String,
}

impl From<InitiativeDetail> for ProjectDetails {
    fn from(value: InitiativeDetail) -> Self {
        let share = value.share_permission;
        let task_count = value.task_ids.len();
        Self {
            initiative_id: value.id.as_uuid(),
            name: value.name,
            description_document_id: value.description_document_id.as_uuid(),
            owner_id: value.owner_id.to_string(),
            member_ids: value
                .member_ids
                .into_iter()
                .map(|id| id.to_string())
                .collect(),
            task_ids: value.task_ids.into_iter().take(200).collect(),
            task_count,
            tasks_truncated: task_count > 200,
            access: value.user_access_level.to_string(),
            team_access: share.team_share_access_level.map(|level| level.to_string()),
            link_scope: share.link_share.map(|scope| scope.to_string()),
            link_access: share.link_share_access_level.map(|level| level.to_string()),
            channel_shares: share
                .channel_share_permissions
                .unwrap_or_default()
                .into_iter()
                .map(|share| ProjectChannelShare {
                    channel_id: share.channel_id,
                    access: share.access_level.to_string(),
                })
                .collect(),
        }
    }
}

/// Canonical system-property values, editable through SetEntityProperty.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPropertyValues {
    /// Status option id, or unset.
    pub status: Option<Uuid>,
    /// Priority option id, or unset.
    pub priority: Option<Uuid>,
    /// Assigned users, independent from sharing membership.
    pub assignees: Vec<String>,
    /// Due timestamp, or unset.
    pub due_date: Option<DateTime<Utc>>,
    /// Whether the status is completed.
    pub completed: bool,
}

impl From<InitiativePropertySnapshot> for ProjectPropertyValues {
    fn from(value: InitiativePropertySnapshot) -> Self {
        Self {
            status: value.status,
            priority: value.priority,
            assignees: value.assignees,
            due_date: value.due_date,
            completed: value.completed,
        }
    }
}

/// Successful project mutation with no further result body.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ProjectOperationComplete {
    /// True when the operation completed.
    pub success: bool,
}
