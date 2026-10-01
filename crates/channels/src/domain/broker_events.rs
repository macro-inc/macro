//! Kafka event models for the `macro.channels` topic.
//!
//! Follows the canonical pattern in `documents/src/domain/events.rs`:
//! per-variant metadata structs, a [`TopicEvent`] enum tagged by `event_type`,
//! and a [`MacroEvent`] wrapper keyed by channel id.

#[cfg(test)]
mod test;

use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroChannelsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::ChannelType;
use messages::domain::models::SimpleMention;

/// Attachment payload carried by channel wire events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelEventAttachment {
    /// Attachment id.
    pub attachment_id: Uuid,
    /// Attached entity type (e.g. `document`).
    pub entity_type: String,
    /// Attached entity id.
    pub entity_id: String,
    /// Creation timestamp of the attachment row.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`ChannelTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelCreatedMetadata {
    /// The id of the created channel.
    pub channel_id: Uuid,
    /// Actor that created the channel (channel owner).
    pub actor: ChannelSender<'static>,
    /// User the actor created the channel for, when the actor is a bot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<MacroUserIdStr<'static>>,
    /// Type of channel that was created.
    pub channel_type: ChannelType,
    /// Stored channel name; `None` for direct message / unnamed channels.
    pub channel_name: Option<String>,
    /// Active participants after creation (including the owner).
    pub participant_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Metadata for [`ChannelTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelUpdatedMetadata {
    /// The id of the updated channel.
    pub channel_id: Uuid,
    /// The user who updated the channel.
    pub actor: MacroUserIdStr<'static>,
    /// Stored channel name before the update.
    pub previous_name: Option<String>,
    /// New channel name.
    pub channel_name: Option<String>,
}

/// Metadata for [`ChannelTopicEvent::Deleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelDeletedMetadata {
    /// The id of the deleted channel.
    pub channel_id: Uuid,
    /// Actor that deleted the channel.
    pub actor: ChannelSender<'static>,
}

/// The channel-only shape of a posted message.
///
/// No longer published on `macro.channels`: message facts travel on
/// `macro.messages` with their parent. The shape survives because the first
/// schema version of `macro.agent_sessions` embeds it, and user-run agent
/// daemons that decode that topic cannot be rolled with a deploy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelMessagePostedMetadata {
    /// Channel containing the message.
    pub channel_id: Uuid,
    /// The id of the posted message.
    pub message_id: Uuid,
    /// Thread parent id when the message is a thread reply.
    pub thread_id: Option<Uuid>,
    /// Message author; may be a bot.
    pub sender: ChannelSender<'static>,
    /// For an agent (bot) message, the id of the user who triggered it.
    pub triggered_by: Option<String>,
    /// Type of channel containing the message.
    pub channel_type: ChannelType,
    /// Message body.
    pub content: String,
    /// Mentions attached to the message.
    pub mentions: Vec<SimpleMention>,
    /// Attachments persisted with the message.
    pub attachments: Vec<ChannelEventAttachment>,
    /// Creation timestamp reported by the repository.
    pub created_at: DateTime<Utc>,
}

/// Metadata for [`ChannelTopicEvent::ParticipantAdded`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelParticipantAddedMetadata {
    /// Channel receiving new participants.
    pub channel_id: Uuid,
    /// Type of channel that received participants.
    pub channel_type: ChannelType,
    /// Actor who added the participants; equals the sole added user for a
    /// self-service join.
    pub added_by: ChannelSender<'static>,
    /// Users added by this mutation.
    pub added_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Metadata for [`ChannelTopicEvent::ParticipantRemoved`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelParticipantRemovedMetadata {
    /// Channel the participants were removed from.
    pub channel_id: Uuid,
    /// Type of channel the participants were removed from.
    pub channel_type: ChannelType,
    /// Actor who removed the participants; equals the sole removed user for a
    /// self-service leave.
    pub removed_by: MacroUserIdStr<'static>,
    /// Users removed by this mutation.
    pub removed_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Events that can be published to [`MacroChannelsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ChannelTopicEvent {
    /// A channel was created.
    #[serde(rename = "channel.created")]
    Created(ChannelCreatedMetadata),
    /// A channel's metadata was updated (rename).
    #[serde(rename = "channel.updated")]
    Updated(ChannelUpdatedMetadata),
    /// A channel was deleted.
    #[serde(rename = "channel.deleted")]
    Deleted(ChannelDeletedMetadata),
    /// Participants were added to a channel (admin invite or self-join).
    #[serde(rename = "channel.participant_added")]
    ParticipantAdded(ChannelParticipantAddedMetadata),
    /// Participants were removed from a channel (admin removal or self-leave).
    #[serde(rename = "channel.participant_removed")]
    ParticipantRemoved(ChannelParticipantRemovedMetadata),
}

impl TopicEvent for ChannelTopicEvent {
    type Topic = MacroChannelsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroChannelsTopic`], keyed by channel id.
pub struct ChannelMacroEvent {
    key: String,
    event: Event<ChannelTopicEvent>,
}

impl ChannelMacroEvent {
    /// Build a created event keyed by the created channel id.
    pub fn created(metadata: ChannelCreatedMetadata) -> Self {
        Self::new(metadata.channel_id, ChannelTopicEvent::Created(metadata))
    }

    /// Build an updated event keyed by the updated channel id.
    pub fn updated(metadata: ChannelUpdatedMetadata) -> Self {
        Self::new(metadata.channel_id, ChannelTopicEvent::Updated(metadata))
    }

    /// Build a deleted event keyed by the deleted channel id.
    pub fn deleted(metadata: ChannelDeletedMetadata) -> Self {
        Self::new(metadata.channel_id, ChannelTopicEvent::Deleted(metadata))
    }

    /// Build a participant added event keyed by the channel id.
    pub fn participant_added(metadata: ChannelParticipantAddedMetadata) -> Self {
        Self::new(
            metadata.channel_id,
            ChannelTopicEvent::ParticipantAdded(metadata),
        )
    }

    /// Build a participant removed event keyed by the channel id.
    pub fn participant_removed(metadata: ChannelParticipantRemovedMetadata) -> Self {
        Self::new(
            metadata.channel_id,
            ChannelTopicEvent::ParticipantRemoved(metadata),
        )
    }

    /// Build an event from a topic-specific event variant, keyed by channel id.
    pub fn new(channel_id: Uuid, event: ChannelTopicEvent) -> Self {
        Self::with_event(channel_id.to_string(), Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<ChannelTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for ChannelMacroEvent {
    type EventPayload = ChannelTopicEvent;

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
