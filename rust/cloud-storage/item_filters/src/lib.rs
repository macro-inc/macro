#![deny(missing_docs)]
//! This crate contains all filters for various item types to be used in soup/search.

use non_empty::IsEmpty;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use utoipa::ToSchema;

pub mod ast;

/// Fields that can be searched on in search queries
#[derive(
    Serialize,
    Deserialize,
    Debug,
    ToSchema,
    Copy,
    Clone,
    EnumString,
    Display,
    PartialEq,
    JsonSchema,
    Default,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SearchOn {
    /// Search on the name/title field only
    Name,
    /// Search on the content field only (default)
    #[default]
    Content,
    /// Search on both name and content fields
    NameContent,
}

/// The document filters used to filter down what documents you search over.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default, PartialEq, Clone, JsonSchema)]
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
}

impl IsEmpty for DocumentFilters {
    fn is_empty(&self) -> bool {
        let DocumentFilters {
            file_types,
            document_ids,
            project_ids,
            owners,
        } = self;
        file_types.is_empty()
            && document_ids.is_empty()
            && project_ids.is_empty()
            && owners.is_empty()
    }
}

/// The chat filters used to filter down what chats you search over.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default, PartialEq, Clone, JsonSchema)]
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
}

impl IsEmpty for ChatFilters {
    fn is_empty(&self) -> bool {
        let ChatFilters {
            role,
            chat_ids,
            project_ids,
            owners,
        } = self;
        role.is_empty() && chat_ids.is_empty() && project_ids.is_empty() && owners.is_empty()
    }
}

/// The email filters used to filter down what emails you search over.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default, PartialEq, Clone, JsonSchema)]
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
}

impl IsEmpty for EmailFilters {
    fn is_empty(&self) -> bool {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
        } = self;
        senders.is_empty() && cc.is_empty() && bcc.is_empty() && recipients.is_empty()
    }
}

/// The channel message filters used to filter down what channel messages you search over.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default, PartialEq, Clone, JsonSchema)]
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
}

impl IsEmpty for ChannelFilters {
    fn is_empty(&self) -> bool {
        let ChannelFilters {
            thread_ids,
            mentions,
            org_id,
            channel_ids,
            sender_ids,
        } = self;
        thread_ids.is_empty()
            && mentions.is_empty()
            && org_id.is_none()
            && channel_ids.is_empty()
            && sender_ids.is_empty()
    }
}

/// The project filters used to filter down what projects you search over.
#[derive(Debug, Serialize, Deserialize, ToSchema, Default, PartialEq, Clone, JsonSchema)]
pub struct ProjectFilters {
    /// Project IDs to search within. Examples: ['project1']. Empty to search all accessible projects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by project owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,
}

impl IsEmpty for ProjectFilters {
    fn is_empty(&self) -> bool {
        let ProjectFilters {
            project_ids,
            owners,
        } = self;
        project_ids.is_empty() && owners.is_empty()
    }
}

/// a bundle of all of the filters for each entity type
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
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
}

impl IsEmpty for EntityFilters {
    fn is_empty(&self) -> bool {
        let EntityFilters {
            project_filters,
            document_filters,
            chat_filters,
            channel_filters,
            email_filters,
        } = self;
        project_filters.is_empty()
            && document_filters.is_empty()
            && chat_filters.is_empty()
            && chat_filters.is_empty()
            && email_filters.is_empty()
            && channel_filters.is_empty()
    }
}
