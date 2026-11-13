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

    const SCHEMA_VERSION: u8 = 1;

    type PublicPayload = MentionPublicEvent;

    fn exposure(
        &self,
    ) -> Result<
        macro_event_broker::exposure::Exposure<'_, Self::PublicPayload>,
        macro_event_broker::exposure::ExposureError,
    > {
        use macro_event_broker::exposure::{
            Audience, EntityRef as PublicEntityRef, EntityType, Exposure, ExposureError,
            PublicEvent, Stage,
        };
        use std::borrow::Cow;
        use std::str::FromStr as _;

        let (name, metadata, wrap): (_, _, fn(PublicMention) -> MentionPublicEvent) = match self {
            Self::Created(metadata) => ("mention.created", metadata, MentionPublicEvent::Created),
            Self::Deleted(metadata) => ("mention.deleted", metadata, MentionPublicEvent::Deleted),
            Self::MessageSent(_) => {
                return Ok(Exposure::internal_by_design(
                    "message.mentioned already delivers each message mention to the message's audience",
                ));
            }
        };
        // The API only records mentions from documents, but the source kind
        // travels as a string; any kind that is not an entity type is a
        // contract violation.
        let source_type = EntityType::from_str(&metadata.source.kind).map_err(|_| {
            ExposureError::InvalidEntityId {
                entity_type: "mention source",
                entity_id: metadata.source.kind.clone(),
            }
        })?;
        let source_id = metadata.source.id.clone();
        Ok(Exposure::Public(PublicEvent {
            name,
            entity: PublicEntityRef::new(source_type, source_id.clone()),
            audience: Audience::Entity {
                entity_type: source_type,
                entity_id: source_id.clone(),
            },
            stage: Stage::Preview,
            payload: Cow::Owned(wrap(PublicMention {
                source_type,
                source_id,
                mentioned_kind: metadata.mentioned.kind.clone(),
                mentioned_id: metadata.mentioned.id.clone(),
            })),
        }))
    }
}

/// The public projection of [`MentionTopicEvent`], delivered to the explicit
/// accessors of the entity the mention appears in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum MentionPublicEvent {
    /// A mention was added to an entity, such as a document.
    #[serde(rename = "mention.created")]
    Created(PublicMention),
    /// A mention was removed from an entity.
    #[serde(rename = "mention.deleted")]
    Deleted(PublicMention),
}

/// Public body of a mention event: where the mention is and what it names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicMention {
    /// Type of the entity the mention appears in.
    pub source_type: macro_event_broker::exposure::EntityType,
    /// The entity the mention appears in.
    pub source_id: String,
    /// Kind of the mentioned entity, such as `user` or `document`.
    pub mentioned_kind: String,
    /// The mentioned entity.
    pub mentioned_id: String,
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
