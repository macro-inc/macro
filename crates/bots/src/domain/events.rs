//! Kafka event models for the `macro.bots` topic.
//!
//! Lifecycle events contain sanitized bot metadata. Bot token values, hashes,
//! identifiers, and token metadata are deliberately excluded from every payload.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroBotsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{BotId, BotKind, BotOwner};

/// Metadata for [`BotTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotCreatedMetadata {
    /// Identifier of the created bot.
    pub bot_id: BotId,
    /// Kind of the created bot.
    pub kind: BotKind,
    /// User or team that owns the bot.
    pub owner: BotOwner,
    /// Display name of the bot.
    pub name: String,
    /// Stable handle of the bot.
    pub handle: String,
    /// Optional bot description.
    pub description: Option<String>,
    /// Optional bot avatar URL.
    pub avatar_url: Option<String>,
    /// Authenticated user who created the bot.
    pub created_by_user_id: MacroUserIdStr<'static>,
    /// Channel for a channel-scoped creation, if any.
    pub channel_id: Option<Uuid>,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`BotTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotUpdatedMetadata {
    /// Identifier of the updated bot.
    pub bot_id: BotId,
    /// User or team that owns the bot.
    pub owner: BotOwner,
    /// Authenticated user who updated the bot.
    pub actor_user_id: MacroUserIdStr<'static>,
    /// Requested display name, or `None` when the PATCH omitted it.
    pub name: Option<String>,
    /// Requested stable handle, or `None` when the PATCH omitted it.
    pub handle: Option<String>,
    /// Requested description, or `None` when the PATCH omitted it.
    pub description: Option<String>,
    /// Requested avatar URL, or `None` when the PATCH omitted it.
    pub avatar_url: Option<String>,
    /// Update timestamp reported by the repository.
    pub updated_at: DateTime<Utc>,
}

/// Metadata for [`BotTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BotDeletedMetadata {
    /// Identifier of the deleted bot.
    pub bot_id: BotId,
    /// User or team that owned the bot.
    pub owner: BotOwner,
    /// Authenticated user who deleted the bot.
    pub actor_user_id: MacroUserIdStr<'static>,
}

/// Lifecycle events published to [`MacroBotsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum BotTopicEvent {
    /// A bot was created.
    #[serde(rename = "bot.created")]
    Created(BotCreatedMetadata),
    /// A bot was updated.
    #[serde(rename = "bot.updated")]
    Updated(BotUpdatedMetadata),
    /// A bot was soft-deleted.
    #[serde(rename = "bot.deleted")]
    Deleted(BotDeletedMetadata),
}

impl TopicEvent for BotTopicEvent {
    type Topic = MacroBotsTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable lifecycle event for [`MacroBotsTopic`], keyed by bot id.
pub struct BotMacroEvent {
    key: String,
    event: Event<BotTopicEvent>,
}

impl BotMacroEvent {
    /// Build a created event keyed by the created bot id.
    pub fn created(metadata: BotCreatedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Created(metadata))
    }

    /// Build an updated event keyed by the updated bot id.
    pub fn updated(metadata: BotUpdatedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Updated(metadata))
    }

    /// Build a deleted event keyed by the deleted bot id.
    pub fn deleted(metadata: BotDeletedMetadata) -> Self {
        let key = metadata.bot_id.to_string();
        Self::new(key, BotTopicEvent::Deleted(metadata))
    }

    fn new(key: String, event: BotTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    fn with_event(key: String, event: Event<BotTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for BotMacroEvent {
    type EventPayload = BotTopicEvent;

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
