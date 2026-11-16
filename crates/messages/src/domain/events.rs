//! Committed message facts shared by consumers independently of transport.
//!
//! One metadata struct per fact, mirroring the channel-only events on the
//! `macro.channels` topic so consumers can move from those to the parent-aware
//! facts without losing fields. Only `channel_type` is absent: it exists for
//! channel parents alone and consumers resolve it from the parent.

use super::models::{Message, MessageParent, SimpleMention};
use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
#[cfg(feature = "broker")]
use macro_event_broker::{TopicEvent, access::EventAccess};
#[cfg(feature = "broker")]
use macro_event_topics::MacroMessagesTopic;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An attachment persisted with a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageEventAttachment {
    /// Attachment row identifier.
    pub attachment_id: Uuid,
    /// Referenced entity type.
    pub entity_type: String,
    /// Referenced entity identifier.
    pub entity_id: String,
    /// Attachment creation timestamp.
    pub created_at: DateTime<Utc>,
}

impl From<&super::models::MessageAttachment> for MessageEventAttachment {
    fn from(attachment: &super::models::MessageAttachment) -> Self {
        Self {
            attachment_id: attachment.id,
            entity_type: attachment.entity_type.clone(),
            entity_id: attachment.entity_id.clone(),
            created_at: attachment.created_at,
        }
    }
}

/// A committed post, independent of the surface presenting the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessagePostedMetadata {
    /// Entity that owns the message and determines access to it.
    pub parent: MessageParent,
    /// Posted message identifier.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a new root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation, shared by roots and replies.
    pub root_id: Uuid,
    /// Author, including bot principals.
    pub sender: ChannelSender<'static>,
    /// User whose invocation produced a bot response.
    pub triggered_by: Option<String>,
    /// Macro Markdown body.
    pub content: String,
    /// Explicit mentions recorded with the post.
    pub mentions: Vec<SimpleMention>,
    /// Persisted attachments available to authorized consumers.
    pub attachments: Vec<MessageEventAttachment>,
    /// Message creation timestamp.
    pub created_at: DateTime<Utc>,
}

impl MessagePostedMetadata {
    /// User authorizing this invocation, including a trusted bot's attribution.
    /// Autonomous bot posts have no invoking user and cannot start paid sessions.
    pub fn invoking_user(&self) -> Option<MacroUserIdStr<'static>> {
        self.sender.as_user().cloned().or_else(|| {
            MacroUserIdStr::parse_from_str(self.triggered_by.as_deref()?)
                .ok()
                .map(CowLike::into_owned)
        })
    }

    /// Build the event from the persisted message, never from client parent claims.
    pub fn from_message(message: &Message, mentions: Vec<SimpleMention>) -> Self {
        Self {
            parent: message.parent.clone(),
            message_id: message.id,
            thread_id: message.thread_id,
            root_id: message.root_id(),
            sender: message.sender_id.clone(),
            triggered_by: message.triggered_by.clone(),
            content: message.content.clone(),
            mentions,
            attachments: message
                .attachments
                .iter()
                .map(MessageEventAttachment::from)
                .collect(),
            created_at: message.created_at,
        }
    }

    /// Stable identity of the conversation, shared by roots and replies.
    pub fn root_id(&self) -> Uuid {
        self.root_id
    }
}

/// One mentioned entity in a committed post; the full mention list travels on
/// the posted fact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageMentionedMetadata {
    /// Entity that owns the message.
    pub parent: MessageParent,
    /// The id of the message carrying the mention.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation.
    pub root_id: Uuid,
    /// Message author; may be a bot.
    pub sender: ChannelSender<'static>,
    /// Macro Markdown body.
    pub content: String,
    /// The mentioned entity this fact is about (`user`, `bot`, `document`, …).
    pub mentioned: SimpleMention,
    /// Message creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// A committed content edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessagePatchedMetadata {
    /// Completed bot answer, evaluated for agent triggers like a new post.
    /// Ordinary edits and streaming updates omit this; older producers remain
    /// compatible with the trigger consumer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_reply: Option<MessagePostedMetadata>,
    /// Entity that owns the message.
    pub parent: MessageParent,
    /// The id of the patched message.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation.
    pub root_id: Uuid,
    /// Actor that patched the message.
    pub actor: ChannelSender<'static>,
    /// Macro Markdown body after the patch.
    pub content: String,
    /// Edit timestamp, when the patch marked the message edited.
    pub edited_at: Option<DateTime<Utc>>,
    /// Update timestamp reported by the repository.
    pub updated_at: DateTime<Utc>,
}

/// A committed message tombstone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageDeletedMetadata {
    /// Entity that owns the message.
    pub parent: MessageParent,
    /// The id of the deleted message.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation.
    pub root_id: Uuid,
    /// Actor that deleted the message; not necessarily the author.
    pub actor: ChannelSender<'static>,
    /// Tombstone timestamp reported by the repository.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Attachments added to a message, on post or by a later edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageAttachmentCreatedMetadata {
    /// Entity that owns the message.
    pub parent: MessageParent,
    /// Message the attachments were added to.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation.
    pub root_id: Uuid,
    /// Actor that added the attachments.
    pub actor: ChannelSender<'static>,
    /// Attachments created by this mutation.
    pub attachments: Vec<MessageEventAttachment>,
}

/// Attachments removed from a message by an edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MessageAttachmentRemovedMetadata {
    /// Entity that owns the message.
    pub parent: MessageParent,
    /// Message the attachments were removed from.
    pub message_id: Uuid,
    /// Root identifier for a reply; absent for a root.
    pub thread_id: Option<Uuid>,
    /// Stable identity of the conversation.
    pub root_id: Uuid,
    /// Actor that removed the attachments.
    pub actor: ChannelSender<'static>,
    /// Attachments removed by this mutation.
    pub attachments: Vec<MessageEventAttachment>,
}

#[cfg(feature = "broker")]
/// Lifecycle events for the common message service, one per committed fact.
/// Reactions and typing never reach the topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum MessageTopicEvent {
    /// A user or bot posted a root or reply.
    #[serde(rename = "message.posted")]
    Posted(MessagePostedMetadata),
    /// A message's content was patched.
    #[serde(rename = "message.patched")]
    Patched(MessagePatchedMetadata),
    /// A message was tombstoned.
    #[serde(rename = "message.deleted")]
    Deleted(MessageDeletedMetadata),
    /// An entity (user, bot, document, …) was mentioned in a posted message.
    #[serde(rename = "message.mentioned")]
    Mentioned(MessageMentionedMetadata),
    /// Attachments were added to a message.
    #[serde(rename = "message.attachment_created")]
    AttachmentCreated(MessageAttachmentCreatedMetadata),
    /// Attachments were removed from a message.
    #[serde(rename = "message.attachment_removed")]
    AttachmentRemoved(MessageAttachmentRemovedMetadata),
}

#[cfg(feature = "broker")]
impl TopicEvent for MessageTopicEvent {
    type Topic = MacroMessagesTopic;
    const SCHEMA_VERSION: u8 = 1;
}

#[cfg(feature = "broker")]
impl EventAccess for MessageTopicEvent {
    type PublicPayload = Self;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{Access, Audience, EntityRef, PublicEvent, Stage};
        use std::borrow::Cow;

        // The entity is the message's parent: access and `ids` filters are by
        // the channel or document that owns the conversation.
        let (name, parent) = match self {
            Self::Posted(metadata) => ("message.posted", &metadata.parent),
            Self::Patched(metadata) => ("message.patched", &metadata.parent),
            Self::Deleted(metadata) => ("message.deleted", &metadata.parent),
            Self::Mentioned(metadata) => ("message.mentioned", &metadata.parent),
            Self::AttachmentCreated(metadata) => ("message.attachment_created", &metadata.parent),
            Self::AttachmentRemoved(metadata) => ("message.attachment_removed", &metadata.parent),
        };
        let entity_id = parent.entity_id();
        Ok(Access::Public(PublicEvent {
            name,
            entity: EntityRef::new(parent.access_entity_type(), entity_id.clone()),
            audience: Audience::Entity {
                entity_type: parent.access_entity_type(),
                entity_id,
            },
            stage: Stage::Stable,
            payload: Cow::Borrowed(self),
        }))
    }
}
