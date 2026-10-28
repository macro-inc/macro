//! CRM company and contact discussion notification projection.

use async_graphql::{Enum, ID, SimpleObject};
use model_notifications::{CrmDiscussionMetadata, CrmDiscussionReason};

/// Why a CRM discussion notification was sent.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlCrmDiscussionReason {
    /// Explicit user mention.
    Mention,
    /// Reply to a discussion.
    Reply,
    /// Comment on an owned company or one of its contacts.
    Owner,
}

/// Metadata for a discussion on a CRM company or contact.
#[derive(SimpleObject)]
pub struct GraphqlCrmDiscussionMetadata {
    /// Company or contact display name.
    record_name: String,
    /// Notification reason.
    reason: GraphqlCrmDiscussionReason,
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

impl From<CrmDiscussionMetadata> for GraphqlCrmDiscussionMetadata {
    fn from(value: CrmDiscussionMetadata) -> Self {
        Self {
            record_name: value.record_name,
            reason: match value.reason {
                CrmDiscussionReason::Mention => GraphqlCrmDiscussionReason::Mention,
                CrmDiscussionReason::Reply => GraphqlCrmDiscussionReason::Reply,
                CrmDiscussionReason::Owner => GraphqlCrmDiscussionReason::Owner,
            },
            message_id: ID(value.message_id.to_string()),
            thread_id: ID(value.thread_id.to_string()),
            text: value.text,
            sender_display_name: value.sender_display_name,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}
