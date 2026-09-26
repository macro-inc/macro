//! Project discussion notification projection.

use async_graphql::{Enum, ID, SimpleObject};
use model_notifications::{InitiativeDiscussionMetadata, InitiativeDiscussionReason};

/// Why a project discussion notification was sent.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlInitiativeDiscussionReason {
    /// Explicit user mention.
    Mention,
    /// Reply to a discussion.
    Reply,
    /// Comment on an assigned project.
    Assignee,
    /// Comment on an owned project.
    Owner,
}

/// Metadata for a discussion in a project.
#[derive(SimpleObject)]
pub struct GraphqlInitiativeDiscussionMetadata {
    /// Project display name.
    project_name: String,
    /// Project owner principal.
    owner: String,
    /// Notification reason.
    reason: GraphqlInitiativeDiscussionReason,
    /// Shared message identifier.
    message_id: ID,
    /// Shared discussion root identifier.
    thread_id: ID,
    /// Comment Markdown.
    text: String,
    /// Public bot display name, if applicable.
    sender_display_name: Option<String>,
    /// Sender avatar URL.
    sender_profile_picture_url: Option<String>,
}

impl From<InitiativeDiscussionMetadata> for GraphqlInitiativeDiscussionMetadata {
    fn from(value: InitiativeDiscussionMetadata) -> Self {
        Self {
            project_name: value.project_name,
            owner: value.owner.to_string(),
            reason: match value.reason {
                InitiativeDiscussionReason::Mention => GraphqlInitiativeDiscussionReason::Mention,
                InitiativeDiscussionReason::Reply => GraphqlInitiativeDiscussionReason::Reply,
                InitiativeDiscussionReason::Assignee => GraphqlInitiativeDiscussionReason::Assignee,
                InitiativeDiscussionReason::Owner => GraphqlInitiativeDiscussionReason::Owner,
            },
            message_id: ID(value.message_id.to_string()),
            thread_id: ID(value.thread_id.to_string()),
            text: value.text,
            sender_display_name: value.sender_display_name,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}
