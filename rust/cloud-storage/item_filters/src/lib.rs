#![deny(missing_docs)]
//! This crate contains all filters for various item types to be used in soup/search.

use non_empty::IsEmpty;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

pub mod ast;

/// Fields that can be searched on in search queries
#[derive(Serialize, Deserialize, Debug, Copy, Clone, EnumString, Display, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub enum SearchOn {
    /// Search on the name/title field only
    Name,
    /// Search on the content field only (default)
    #[default]
    Content,
    /// Search on both name and content fields
    NameContent,
}

/// Notification-level filters that apply to an entity type.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct NotificationFilters {
    /// Filter by notification done state.
    /// None to ignore, true to include only done notifications, false to include only not-done notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,

    /// Filter by notification seen state.
    /// None to ignore, true to include only seen notifications, false to include only unseen notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<bool>,
}

impl IsEmpty for NotificationFilters {
    fn is_empty(&self) -> bool {
        let NotificationFilters { done, seen } = self;
        done.is_none() && seen.is_none()
    }
}

/// Task-only filters nested under document filters.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct TaskFilters {
    /// Include tasks that are created by me, assigned to me, and not completed,
    /// even when they do not match other document filters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_cbm_atm_nc: Option<bool>,
}

impl IsEmpty for TaskFilters {
    fn is_empty(&self) -> bool {
        // false is equivalent to "disabled" and should not affect filtering.
        self.include_cbm_atm_nc != Some(true)
    }
}

/// The document filters used to filter down what documents you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct DocumentFilters {
    /// Document file types to search. Examples: ['pdf'], ['md', 'txt']. Empty to search all file types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_types: Vec<String>,

    /// Document ids to search over. Examples: ['doc1'], ['doc1', 'doc2']. Empty to search all accessible documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub document_ids: Vec<String>,

    /// A list of project ids to search within. Examples: ['project1'].
    /// filtering. Empty to ignore project filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by document owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by document importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by document notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,

    /// Task-specific filters that only apply to task subtype documents.
    #[serde(default, skip_serializing_if = "TaskFilters::is_empty")]
    pub task_filters: TaskFilters,

    /// Filter by document sub type. Examples: ['task']. Empty to search all sub types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sub_types: Vec<String>,
}

impl IsEmpty for DocumentFilters {
    fn is_empty(&self) -> bool {
        let DocumentFilters {
            file_types,
            document_ids,
            project_ids,
            owners,
            importance,
            notification_filters,
            task_filters,
            sub_types,
        } = self;
        file_types.is_empty()
            && document_ids.is_empty()
            && project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
            && task_filters.is_empty()
            && sub_types.is_empty()
    }
}

/// The chat filters used to filter down what chats you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ChatFilters {
    /// Chat message roles to search. Examples: ['user'], ['assistant']. Empty to search all roles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub role: Vec<String>,

    /// Chat ids to search over. Examples: ['chat1'], ['chat1', 'chat2']. When provided, chat search will only match results on these chats. Empty to search all accessible chats.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chat_ids: Vec<String>,

    /// A list of project ids to search within. Examples: ['project1']. Empty to ignore project filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by chat owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by chat importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by chat notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ChatFilters {
    fn is_empty(&self) -> bool {
        let ChatFilters {
            role,
            chat_ids,
            project_ids,
            owners,
            importance,
            notification_filters,
        } = self;
        role.is_empty()
            && chat_ids.is_empty()
            && project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// The email filters used to filter down what emails you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct EmailFilters {
    /// Email sender addresses to filter by. Examples: ['user@example.com']. Empty to search all senders.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub senders: Vec<String>,
    /// Email CC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by CC.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cc: Vec<String>,
    /// Email BCC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by BCC.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bcc: Vec<String>,
    /// Email Recipient addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by Recipient.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipients: Vec<String>,

    /// Email thread IDs to filter by. Examples: ['thread-uuid-1']. Empty to search all threads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_thread_ids: Vec<String>,

    /// Filter by email importance. None to not filter. True to show only important emails
    /// (drafts, personal, sent, or uncategorized). False to show only unimportant emails
    /// (those categorized as promotions, social, updates, or forums).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by email notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,

    /// Only include emails that have at least one of these labels. Supports both Gmail system labels (e.g. "INBOX", "CATEGORY_PROMOTIONS") and user-created labels (e.g. "github"). Empty to not filter by included labels.
    /// Note: SPAM and TRASH emails are not indexed in OpenSearch, so they will never appear in results regardless of this filter.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub include_labels: Vec<String>,

    /// Exclude emails that have any of these labels. Supports both Gmail system labels (e.g. "CATEGORY_PROMOTIONS") and user-created labels. Empty to not exclude any labels.
    /// Note: SPAM and TRASH emails are not indexed in OpenSearch, so they are already excluded by default.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude_labels: Vec<String>,
}

impl IsEmpty for EmailFilters {
    fn is_empty(&self) -> bool {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
            email_thread_ids,
            importance,
            notification_filters,
            include_labels,
            exclude_labels,
        } = self;
        senders.is_empty()
            && cc.is_empty()
            && bcc.is_empty()
            && recipients.is_empty()
            && email_thread_ids.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
            && include_labels.is_empty()
            && exclude_labels.is_empty()
    }
}

/// The channel message filters used to filter down what channel messages you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ChannelFilters {
    /// Channel thread IDs to search within. Examples: ['thread123']. Empty to search all threads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thread_ids: Vec<String>,
    /// Channel user mentions to search for. Examples: ['@username']. Empty if not filtering by mentions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<String>,
    /// Channel organization ID to search within. Empty to ignore organization filtering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_id: Option<i64>,
    /// Channel IDs to search within. Examples: ['general']. Empty to search all accessible channels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_ids: Vec<String>,
    /// Sender IDs to search within. Examples: ['user1']. Empty to search all accessible senders.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sender_ids: Vec<String>,

    /// Channel types to filter by. Examples: ['public'], ['direct_message', 'private']. Empty to search all channel types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_types: Vec<String>,

    /// Filter by channel importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by channel notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ChannelFilters {
    fn is_empty(&self) -> bool {
        let ChannelFilters {
            thread_ids,
            mentions,
            org_id,
            channel_ids,
            sender_ids,
            channel_types,
            importance,
            notification_filters,
        } = self;
        thread_ids.is_empty()
            && mentions.is_empty()
            && org_id.is_none()
            && channel_ids.is_empty()
            && sender_ids.is_empty()
            && channel_types.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// A single property-based filter condition.
///
/// Each filter targets a specific property definition on entities of a given type,
/// matching against select option UUIDs or entity reference IDs.
/// Multiple values within a single filter are OR'd together.
/// Multiple filters are AND'd together.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct PropertyFilter {
    /// The UUID of the property definition to filter on.
    pub property_definition_id: String,
    /// The entity type for the property lookup (e.g., "TASK", "DOCUMENT", "PROJECT").
    /// When None, matches across all entity types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    /// Select option UUIDs to match. Multiple values are OR'd together.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub option_ids: Vec<String>,
    /// Entity reference IDs to match. Multiple values are OR'd together.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entity_ids: Vec<String>,
}

impl IsEmpty for PropertyFilter {
    fn is_empty(&self) -> bool {
        self.option_ids.is_empty() && self.entity_ids.is_empty()
    }
}

/// The project filters used to filter down what projects you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ProjectFilters {
    /// Project IDs to search within. Examples: ['project1']. Empty to search all accessible projects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by project owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by project importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by project notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ProjectFilters {
    fn is_empty(&self) -> bool {
        let ProjectFilters {
            project_ids,
            owners,
            importance,
            notification_filters,
        } = self;
        project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// a bundle of all of the filters for each entity type
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct EntityFilters {
    /// the bundled [ProjectFilters]
    #[serde(default)]
    pub project_filters: ProjectFilters,
    /// the bundled [DocumentFilters]
    #[serde(default)]
    pub document_filters: DocumentFilters,
    /// the bundled [ChatFilters]
    #[serde(default)]
    pub chat_filters: ChatFilters,
    /// the bundled [ChannelFilters]
    #[serde(default)]
    pub channel_filters: ChannelFilters,
    /// the bundled [EmailFilters]
    #[serde(default)]
    pub email_filters: EmailFilters,
    /// property-based filters applied across entity types
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub property_filters: Vec<PropertyFilter>,
}

impl IsEmpty for EntityFilters {
    fn is_empty(&self) -> bool {
        let EntityFilters {
            project_filters,
            document_filters,
            chat_filters,
            channel_filters,
            email_filters,
            property_filters,
        } = self;
        project_filters.is_empty()
            && document_filters.is_empty()
            && chat_filters.is_empty()
            && chat_filters.is_empty()
            && email_filters.is_empty()
            && channel_filters.is_empty()
            && property_filters.iter().all(IsEmpty::is_empty)
    }
}
