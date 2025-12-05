//! System property key enum.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// System property keys with stable UUIDs.
///
/// These are predefined properties managed by the system.
/// Users cannot create or delete these, but can apply them to entities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemPropertyKey {
    // Tasks
    Assignees,
    Status,
    Priority,
    DueDate,
    ParentTask,
    Subtasks,
    DependsOn,
    Effort,
    StoryPoints,
    RelevantDocuments,

    // Emails Attachments
    Source,
    Companies,
    Sender,
    Recipients,
    Subject,
}

impl SystemPropertyKey {
    pub const ASSIGNEES_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000001);
    pub const STATUS_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000002);
    pub const PRIORITY_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000003);
    pub const DUE_DATE_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000004);
    pub const PARENT_TASK_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000005);
    pub const SUBTASKS_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000006);
    pub const DEPENDS_ON_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000007);
    pub const EFFORT_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000008);
    pub const STORY_POINTS_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_000000000009);
    pub const RELEVANT_DOCUMENTS_UUID: Uuid =
        Uuid::from_u128(0x00000001_0000_0000_0000_00000000000a);
    pub const SOURCE_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000b);
    pub const COMPANIES_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000c);
    pub const SENDER_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000d);
    pub const RECIPIENTS_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000e);
    pub const SUBJECT_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0000_00000000000f);

    /// Get the UUID for this system property.
    pub const fn uuid(&self) -> Uuid {
        match self {
            Self::Assignees => Self::ASSIGNEES_UUID,
            Self::Status => Self::STATUS_UUID,
            Self::Priority => Self::PRIORITY_UUID,
            Self::DueDate => Self::DUE_DATE_UUID,
            Self::ParentTask => Self::PARENT_TASK_UUID,
            Self::Subtasks => Self::SUBTASKS_UUID,
            Self::DependsOn => Self::DEPENDS_ON_UUID,
            Self::Effort => Self::EFFORT_UUID,
            Self::StoryPoints => Self::STORY_POINTS_UUID,
            Self::RelevantDocuments => Self::RELEVANT_DOCUMENTS_UUID,
            Self::Source => Self::SOURCE_UUID,
            Self::Companies => Self::COMPANIES_UUID,
            Self::Sender => Self::SENDER_UUID,
            Self::Recipients => Self::RECIPIENTS_UUID,
            Self::Subject => Self::SUBJECT_UUID,
        }
    }

    /// Get the display name for this system property.
    pub const fn display_name(&self) -> &'static str {
        match self {
            Self::Assignees => "Assignees",
            Self::Status => "Status",
            Self::Priority => "Priority",
            Self::DueDate => "Due Date",
            Self::ParentTask => "Parent Task",
            Self::Subtasks => "Subtasks",
            Self::DependsOn => "Depends On",
            Self::Effort => "Effort",
            Self::StoryPoints => "Story Points",
            Self::RelevantDocuments => "Relevant Documents",
            Self::Source => "Source",
            Self::Companies => "Companies",
            Self::Sender => "Sender",
            Self::Recipients => "Recipients",
            Self::Subject => "Subject",
        }
    }

    /// Try to get a SystemPropertyKey from a UUID.
    pub fn from_uuid(uuid: Uuid) -> Option<Self> {
        match uuid {
            u if u == Self::ASSIGNEES_UUID => Some(Self::Assignees),
            u if u == Self::STATUS_UUID => Some(Self::Status),
            u if u == Self::PRIORITY_UUID => Some(Self::Priority),
            u if u == Self::DUE_DATE_UUID => Some(Self::DueDate),
            u if u == Self::PARENT_TASK_UUID => Some(Self::ParentTask),
            u if u == Self::SUBTASKS_UUID => Some(Self::Subtasks),
            u if u == Self::DEPENDS_ON_UUID => Some(Self::DependsOn),
            u if u == Self::EFFORT_UUID => Some(Self::Effort),
            u if u == Self::STORY_POINTS_UUID => Some(Self::StoryPoints),
            u if u == Self::RELEVANT_DOCUMENTS_UUID => Some(Self::RelevantDocuments),
            u if u == Self::SOURCE_UUID => Some(Self::Source),
            u if u == Self::COMPANIES_UUID => Some(Self::Companies),
            u if u == Self::SENDER_UUID => Some(Self::Sender),
            u if u == Self::RECIPIENTS_UUID => Some(Self::Recipients),
            u if u == Self::SUBJECT_UUID => Some(Self::Subject),
            _ => None,
        }
    }

    /// Check if a UUID is a system property UUID.
    pub fn is_system_uuid(uuid: Uuid) -> bool {
        Self::from_uuid(uuid).is_some()
    }
}
