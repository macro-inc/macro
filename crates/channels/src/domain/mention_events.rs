//! Kafka event models for the `macro.mentions` topic.
//!
//! Follows the canonical pattern in `broker_events.rs`: a metadata struct, a
//! [`TopicEvent`] enum tagged by `event_type`, and a [`MacroEvent`] wrapper.
//! Unlike per-domain topics, this one is keyed by the *mentioned* entity id
//! rather than the source, so a consumer (e.g. a bot) can find mentions of
//! its own id across both channel messages and docs. The payload is kept
//! intentionally minimal: a reference (id + kind) to the source and the
//! mentioned entity, nothing else.

#[cfg(test)]
mod test;

use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroMentionsTopic;
use serde::{Deserialize, Serialize};

use crate::domain::models::EntityMention;

/// A reference to an entity by id and kind (e.g. `"user"`, `"bot"`, `"doc"`, `"message"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityRef {
    /// The entity's id.
    pub id: String,
    /// The entity's kind.
    pub kind: String,
}

/// Metadata shared by every [`MentionTopicEvent`] variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MentionMetadata {
    /// The entity that owns the mention (e.g. the message or doc it appears in).
    pub source: EntityRef,
    /// The entity that was mentioned.
    pub mentioned: EntityRef,
}

impl From<&EntityMention> for MentionMetadata {
    fn from(mention: &EntityMention) -> Self {
        Self {
            source: EntityRef {
                id: mention.source_entity_id.clone(),
                kind: mention.source_entity_type.clone(),
            },
            mentioned: EntityRef {
                id: mention.entity_id.clone(),
                kind: mention.entity_type.clone(),
            },
        }
    }
}

/// Events that can be published to [`MacroMentionsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum MentionTopicEvent {
    /// A mention was recorded outside of a thread (e.g. a doc mentioning another entity).
    #[serde(rename = "mention.created")]
    Created(MentionMetadata),
    /// A mention was removed outside of a thread.
    #[serde(rename = "mention.deleted")]
    Deleted(MentionMetadata),
    /// A mention was included in a message sent to a thread (chat/email/channel).
    #[serde(rename = "mention.message_sent")]
    MessageSent(MentionMetadata),
}

impl TopicEvent for MentionTopicEvent {
    type Topic = MacroMentionsTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable event for [`MacroMentionsTopic`], keyed by the mentioned
/// entity id.
pub struct MentionMacroEvent {
    key: String,
    event: Event<MentionTopicEvent>,
}

impl MentionMacroEvent {
    /// Build a created event keyed by the mentioned entity id.
    pub fn created(metadata: MentionMetadata) -> Self {
        Self::new(
            metadata.mentioned.id.clone(),
            MentionTopicEvent::Created(metadata),
        )
    }

    /// Build a deleted event keyed by the mentioned entity id.
    pub fn deleted(metadata: MentionMetadata) -> Self {
        Self::new(
            metadata.mentioned.id.clone(),
            MentionTopicEvent::Deleted(metadata),
        )
    }

    /// Build a message-sent event keyed by the mentioned entity id.
    pub fn message_sent(metadata: MentionMetadata) -> Self {
        Self::new(
            metadata.mentioned.id.clone(),
            MentionTopicEvent::MessageSent(metadata),
        )
    }

    fn new(key: String, event: MentionTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<MentionTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for MentionMacroEvent {
    type EventPayload = MentionTopicEvent;

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
