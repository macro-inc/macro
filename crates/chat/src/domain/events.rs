//! Kafka event models for the `macro.chats` topic.
//!
//! Event payloads deliberately exclude message content, attachment content,
//! and share-permission payloads; only ids, names, roles, and counts are
//! published.

#[cfg(test)]
mod test;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroChatsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use serde::{Deserialize, Serialize};

/// Metadata for [`ChatTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatCreatedMetadata {
    /// Identifier of the created chat.
    pub chat_id: String,
    /// Principal who owns the chat.
    pub owner: Owner,
    /// Display name of the chat.
    pub name: String,
    /// Project the chat was created in, when any.
    pub project_id: Option<String>,
}

/// Metadata for [`ChatTopicEvent::Updated`].
///
/// Share permission payloads are deliberately excluded; only the
/// [`share_permission_updated`](Self::share_permission_updated) flag is published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatUpdatedMetadata {
    /// Identifier of the updated chat.
    pub chat_id: String,
    /// Authenticated user who updated the chat.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Requested display name; `None` when unchanged.
    pub name: Option<String>,
    /// Project id before the update.
    pub previous_project_id: Option<String>,
    /// New project id; `None` when unchanged, `Some("")` when the chat was
    /// removed from its project (mirrors the `PatchChatArgs` semantics).
    pub project_id: Option<String>,
    /// Whether share permissions were updated.
    pub share_permission_updated: bool,
}

/// Metadata for [`ChatTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatDeletedMetadata {
    /// Identifier of the soft-deleted chat.
    pub chat_id: String,
    /// The authenticated user who deleted the chat; `None` for
    /// unauthenticated or internal callers.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Project the chat belonged to, when any.
    pub project_id: Option<String>,
}

/// Metadata for [`ChatTopicEvent::PermanentlyDeleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatPermanentlyDeletedMetadata {
    /// Identifier of the permanently deleted chat.
    pub chat_id: String,
    /// The authenticated user who permanently deleted the chat; `None` for
    /// unauthenticated or internal callers.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Project the chat belonged to, when any.
    pub project_id: Option<String>,
}

/// Metadata for [`ChatTopicEvent::Restored`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatRestoredMetadata {
    /// Identifier of the restored chat.
    pub chat_id: String,
    /// The authenticated user who restored the chat; `None` for
    /// unauthenticated or internal callers.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Project the chat belongs to, when any.
    pub project_id: Option<String>,
}

/// Metadata for [`ChatTopicEvent::Copied`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatCopiedMetadata {
    /// Identifier of the newly created copy.
    pub chat_id: String,
    /// Identifier of the chat that was copied.
    pub source_chat_id: String,
    /// User who owns the new copy (the copier).
    pub owner: MacroUserIdStr<'static>,
    /// Display name of the new chat.
    pub name: String,
}

/// Role of the sender of a chat message.
///
/// Defined locally so the wire contract does not depend on another crate's
/// serde attributes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageRole {
    /// A user message.
    User,
    /// An assistant (model) message.
    Assistant,
    /// A system prompt.
    System,
}

impl From<agent::types::Role> for ChatMessageRole {
    fn from(role: agent::types::Role) -> Self {
        match role {
            agent::types::Role::User => Self::User,
            agent::types::Role::Assistant => Self::Assistant,
            agent::types::Role::System => Self::System,
        }
    }
}

/// Metadata for [`ChatTopicEvent::MessageSent`].
///
/// Message content is deliberately excluded; only ids, role, model, and the
/// attachment count are published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessageSentMetadata {
    /// Identifier of the chat the message belongs to.
    pub chat_id: String,
    /// Identifier of the persisted message.
    pub message_id: String,
    /// Role of the message sender.
    pub role: ChatMessageRole,
    /// Model associated with the message.
    pub model: String,
    /// The sender for user messages; `None` for assistant messages.
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
    /// Number of attachments on the message.
    pub attachment_count: usize,
}

/// Metadata for [`ChatTopicEvent::MessageDeleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessageDeletedMetadata {
    /// Identifier of the chat the message belonged to.
    pub chat_id: String,
    /// Identifier of the deleted message.
    pub message_id: String,
}

/// Lifecycle and message events published to [`MacroChatsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ChatTopicEvent {
    /// A chat was created.
    #[serde(rename = "chat.created")]
    Created(ChatCreatedMetadata),
    /// A chat's metadata / permissions were updated.
    #[serde(rename = "chat.updated")]
    Updated(ChatUpdatedMetadata),
    /// A chat was soft-deleted.
    #[serde(rename = "chat.deleted")]
    Deleted(ChatDeletedMetadata),
    /// A chat was permanently deleted.
    #[serde(rename = "chat.permanently_deleted")]
    PermanentlyDeleted(ChatPermanentlyDeletedMetadata),
    /// A soft-deleted chat was restored.
    #[serde(rename = "chat.restored")]
    Restored(ChatRestoredMetadata),
    /// A chat was copied.
    #[serde(rename = "chat.copied")]
    Copied(ChatCopiedMetadata),
    /// A message was persisted to a chat.
    #[serde(rename = "chat.message_sent")]
    MessageSent(ChatMessageSentMetadata),
    /// A message was permanently deleted from a chat.
    #[serde(rename = "chat.message_deleted")]
    MessageDeleted(ChatMessageDeletedMetadata),
}

/// What a [`ChatTopicEvent::Updated`] changed, without the new values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatChange {
    /// The chat was renamed.
    Name,
    /// The chat moved into, out of, or between projects.
    Project,
    /// Who the chat is shared with changed.
    Sharing,
}

/// Public payload of `chat.created`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatCreated {
    /// The created chat.
    pub chat_id: String,
    /// The project it was created in, when any.
    pub project_id: Option<String>,
}

/// Public payload of `chat.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatUpdated {
    /// The updated chat.
    pub chat_id: String,
    /// The user who updated it.
    #[schema(value_type = String)]
    pub actor_user_id: MacroUserIdStr<'static>,
    /// What changed; read the chat for the new values.
    pub changes: Vec<ChatChange>,
}

/// Public payload of `chat.deleted` and `chat.restored`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatTrash {
    /// The chat moved to or out of the trash.
    pub chat_id: String,
    /// The user who acted, if any.
    #[schema(value_type = Option<String>)]
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
}

/// Public payload of `chat.copied`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatCopied {
    /// The new chat.
    pub chat_id: String,
    /// The chat it was copied from.
    pub source_chat_id: String,
}

/// Public payload of `chat.message_sent`: no content, model or attachments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatMessageSent {
    /// The chat the message is in.
    pub chat_id: String,
    /// The new message.
    pub message_id: String,
    /// Who the message is from.
    pub role: ChatMessageRole,
    /// The user who sent it, for user messages.
    #[schema(value_type = Option<String>)]
    pub actor_user_id: Option<MacroUserIdStr<'static>>,
}

/// Public payload of `chat.message_deleted`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
pub struct PublicChatMessageDeleted {
    /// The chat the message was in.
    pub chat_id: String,
    /// The deleted message.
    pub message_id: String,
}

/// The public projection of [`ChatTopicEvent`], delivered under the same
/// event names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ChatPublicEvent {
    /// A chat was created.
    #[serde(rename = "chat.created")]
    Created(PublicChatCreated),
    /// A chat's name, project or sharing changed.
    #[serde(rename = "chat.updated")]
    Updated(PublicChatUpdated),
    /// A chat was moved to the trash.
    #[serde(rename = "chat.deleted")]
    Deleted(PublicChatTrash),
    /// A chat was restored from the trash.
    #[serde(rename = "chat.restored")]
    Restored(PublicChatTrash),
    /// A chat was copied.
    #[serde(rename = "chat.copied")]
    Copied(PublicChatCopied),
    /// A message was added to a chat.
    #[serde(rename = "chat.message_sent")]
    MessageSent(PublicChatMessageSent),
    /// A message was deleted from a chat.
    #[serde(rename = "chat.message_deleted")]
    MessageDeleted(PublicChatMessageDeleted),
}

impl TopicEvent for ChatTopicEvent {
    type Topic = MacroChatsTopic;

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = ChatPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef, EntityType, Exposure, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        let (name, chat_id, payload) = match self {
            Self::Created(metadata) => (
                "chat.created",
                &metadata.chat_id,
                ChatPublicEvent::Created(PublicChatCreated {
                    chat_id: metadata.chat_id.clone(),
                    project_id: metadata.project_id.clone(),
                }),
            ),
            Self::Updated(metadata) => (
                "chat.updated",
                &metadata.chat_id,
                ChatPublicEvent::Updated(PublicChatUpdated {
                    chat_id: metadata.chat_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                    changes: [
                        (metadata.name.is_some(), ChatChange::Name),
                        (metadata.project_id.is_some(), ChatChange::Project),
                        (metadata.share_permission_updated, ChatChange::Sharing),
                    ]
                    .into_iter()
                    .filter_map(|(changed, change)| changed.then_some(change))
                    .collect(),
                }),
            ),
            Self::Deleted(metadata) => (
                "chat.deleted",
                &metadata.chat_id,
                ChatPublicEvent::Deleted(PublicChatTrash {
                    chat_id: metadata.chat_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                }),
            ),
            Self::Restored(metadata) => (
                "chat.restored",
                &metadata.chat_id,
                ChatPublicEvent::Restored(PublicChatTrash {
                    chat_id: metadata.chat_id.clone(),
                    actor_user_id: metadata.actor_user_id.clone(),
                }),
            ),
            Self::Copied(metadata) => (
                "chat.copied",
                &metadata.chat_id,
                ChatPublicEvent::Copied(PublicChatCopied {
                    chat_id: metadata.chat_id.clone(),
                    source_chat_id: metadata.source_chat_id.clone(),
                }),
            ),
            Self::MessageSent(metadata) => (
                "chat.message_sent",
                &metadata.chat_id,
                ChatPublicEvent::MessageSent(PublicChatMessageSent {
                    chat_id: metadata.chat_id.clone(),
                    message_id: metadata.message_id.clone(),
                    role: metadata.role,
                    actor_user_id: metadata.actor_user_id.clone(),
                }),
            ),
            Self::MessageDeleted(metadata) => (
                "chat.message_deleted",
                &metadata.chat_id,
                ChatPublicEvent::MessageDeleted(PublicChatMessageDeleted {
                    chat_id: metadata.chat_id.clone(),
                    message_id: metadata.message_id.clone(),
                }),
            ),
            Self::PermanentlyDeleted(_) => {
                return Ok(Exposure::internal_by_design(
                    "carries no owner and its grants are gone when consumed, so it has no audience; chat.deleted is the public signal",
                ));
            }
        };
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Chat, chat_id.clone()),
            audience: Audience::Entity {
                entity_type: EntityType::Chat,
                entity_id: chat_id.clone(),
            },
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}

/// Publishable event for [`MacroChatsTopic`], keyed by the chat's bare id.
pub struct ChatMacroEvent {
    key: String,
    event: Event<ChatTopicEvent>,
}

impl ChatMacroEvent {
    /// Build a chat-created event keyed by the new chat id.
    pub fn created(metadata: ChatCreatedMetadata) -> Self {
        Self::new(metadata.chat_id.clone(), ChatTopicEvent::Created(metadata))
    }

    /// Build a chat-updated event keyed by the updated chat id.
    pub fn updated(metadata: ChatUpdatedMetadata) -> Self {
        Self::new(metadata.chat_id.clone(), ChatTopicEvent::Updated(metadata))
    }

    /// Build a chat-deleted event keyed by the deleted chat id.
    pub fn deleted(metadata: ChatDeletedMetadata) -> Self {
        Self::new(metadata.chat_id.clone(), ChatTopicEvent::Deleted(metadata))
    }

    /// Build a chat-permanently-deleted event keyed by the deleted chat id.
    pub fn permanently_deleted(metadata: ChatPermanentlyDeletedMetadata) -> Self {
        Self::new(
            metadata.chat_id.clone(),
            ChatTopicEvent::PermanentlyDeleted(metadata),
        )
    }

    /// Build a chat-restored event keyed by the restored chat id.
    pub fn restored(metadata: ChatRestoredMetadata) -> Self {
        Self::new(metadata.chat_id.clone(), ChatTopicEvent::Restored(metadata))
    }

    /// Build a chat-copied event keyed by the new chat id.
    pub fn copied(metadata: ChatCopiedMetadata) -> Self {
        Self::new(metadata.chat_id.clone(), ChatTopicEvent::Copied(metadata))
    }

    /// Build a message-sent event keyed by the parent chat id, preserving
    /// per-chat ordering.
    pub fn message_sent(metadata: ChatMessageSentMetadata) -> Self {
        Self::new(
            metadata.chat_id.clone(),
            ChatTopicEvent::MessageSent(metadata),
        )
    }

    /// Build a message-deleted event keyed by the parent chat id, preserving
    /// per-chat ordering.
    pub fn message_deleted(metadata: ChatMessageDeletedMetadata) -> Self {
        Self::new(
            metadata.chat_id.clone(),
            ChatTopicEvent::MessageDeleted(metadata),
        )
    }

    fn new(key: String, event: ChatTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    fn with_event(key: String, event: Event<ChatTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for ChatMacroEvent {
    type EventPayload = ChatTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
