//! The committed-post events a trigger consumer may read, and how each
//! becomes the one shape the trigger evaluates.
//!
//! `message.posted` on `macro.messages` is the source of record: it carries the
//! persisted parent, so a mention in a document discussion routes like one in a
//! channel. `channel.message_posted` on `macro.channels` is the event the
//! trigger read before parents existed; it decodes into the same shape with a
//! channel parent, so a deployment can switch back to it with a config change
//! until the producer retires it. Only one source is read at a time: every
//! channel post is published on both topics, so reading both would evaluate
//! every channel mention twice.
//! Both configurations also read `macro.properties` for task assignments.

#[cfg(test)]
mod test;

use super::broker_events::posted_from_channel_event;
use super::processing::TriggerInput;
use super::task_assignment::TaskAssignment;
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use macro_event_broker::{MacroEvent as _, MacroEventCollection};
use macro_uuid::Uuid;
use messages::outbound::broker::{MessageMacroEvent, MessageTopicEvent};
use properties::domain::events::{PropertyMacroEvent, PropertyTopicEvent};
use serde::Deserialize;

/// Which topic a trigger consumer subscribes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerEventSource {
    /// `message.posted` on `macro.messages`: channel and document posts alike.
    #[default]
    Messages,
    /// `channel.message_posted` on `macro.channels`: channel posts only.
    Channels,
}

impl std::str::FromStr for TriggerEventSource {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "messages" => Ok(Self::Messages),
            "channels" => Ok(Self::Channels),
            other => Err(format!(
                "unknown agent trigger event source {other:?}; expected `messages` or `channels`"
            )),
        }
    }
}

macro_event_broker::declare_topics!(MessageTriggerEvents: MessageMacroEvent, PropertyMacroEvent);
macro_event_broker::declare_topics!(ChannelTriggerEvents: ChannelMacroEvent, PropertyMacroEvent);

/// A decoded broker record from one trigger source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTrigger {
    /// Broker event id, for tracing.
    pub event_id: Uuid,
    /// Wire name of the decoded event.
    pub event_type: &'static str,
    /// The committed post, when the record was one; other facts on the topic
    /// carry no trigger.
    pub posted: Option<TriggerInput>,
    /// Newly assigned agents, independent of the configured message source.
    pub assignment: Option<TaskAssignment>,
}

/// A topic collection whose records may carry a committed post.
pub trait TriggerEvents: MacroEventCollection + Send + 'static {
    /// The source this collection reads.
    const SOURCE: TriggerEventSource;

    /// Reduce a decoded record to the post it carries, if any.
    fn into_trigger(self) -> DecodedTrigger;
}

impl TriggerEvents for MessageTriggerEvents {
    const SOURCE: TriggerEventSource = TriggerEventSource::Messages;

    fn into_trigger(self) -> DecodedTrigger {
        let event = match self {
            Self::MessageMacroEvent(event) => event,
            Self::PropertyMacroEvent(event) => return property_trigger(event),
        };
        let envelope = event.event();
        let (event_type, posted) = match &envelope.event {
            MessageTopicEvent::Posted(posted) => (
                "message.posted",
                Some(TriggerInput {
                    posted: posted.clone(),
                    channel_type: None,
                }),
            ),
            MessageTopicEvent::Patched(_) => ("message.patched", None),
            MessageTopicEvent::Deleted(_) => ("message.deleted", None),
            MessageTopicEvent::Mentioned(_) => ("message.mentioned", None),
            MessageTopicEvent::AttachmentCreated(_) => ("message.attachment_created", None),
            MessageTopicEvent::AttachmentRemoved(_) => ("message.attachment_removed", None),
        };
        DecodedTrigger {
            event_id: envelope.event_id,
            event_type,
            posted,
            assignment: None,
        }
    }
}

impl TriggerEvents for ChannelTriggerEvents {
    const SOURCE: TriggerEventSource = TriggerEventSource::Channels;

    fn into_trigger(self) -> DecodedTrigger {
        let event = match self {
            Self::ChannelMacroEvent(event) => event,
            Self::PropertyMacroEvent(event) => return property_trigger(event),
        };
        let envelope = event.event();
        let posted = match &envelope.event {
            ChannelTopicEvent::MessagePosted(posted) => Some(TriggerInput {
                posted: posted_from_channel_event(posted),
                channel_type: Some(posted.channel_type),
            }),
            _ => None,
        };
        DecodedTrigger {
            event_id: envelope.event_id,
            event_type: channel_event_type(&envelope.event),
            posted,
            assignment: None,
        }
    }
}

fn property_trigger(event: PropertyMacroEvent) -> DecodedTrigger {
    let envelope = event.event();
    let (event_type, assignment) = match &envelope.event {
        PropertyTopicEvent::EntityPropertyUpdated(updated) => (
            "entity_property.updated",
            TaskAssignment::from_update(envelope.event_id, updated),
        ),
        PropertyTopicEvent::Created(_) => ("property.created", None),
        PropertyTopicEvent::Deleted(_) => ("property.deleted", None),
        PropertyTopicEvent::OptionCreated(_) => ("property_option.created", None),
        PropertyTopicEvent::OptionUpdated(_) => ("property_option.updated", None),
        PropertyTopicEvent::OptionDeleted(_) => ("property_option.deleted", None),
        PropertyTopicEvent::EntityPropertyDeleted(_) => ("entity_property.deleted", None),
        PropertyTopicEvent::EntityPropertiesCleared(_) => ("entity_properties.cleared", None),
    };
    DecodedTrigger {
        event_id: envelope.event_id,
        event_type,
        posted: None,
        assignment,
    }
}

/// The wire name of a channel topic event, as its serde tag spells it.
fn channel_event_type(event: &ChannelTopicEvent) -> &'static str {
    match event {
        ChannelTopicEvent::Created(_) => "channel.created",
        ChannelTopicEvent::Updated(_) => "channel.updated",
        ChannelTopicEvent::Deleted(_) => "channel.deleted",
        ChannelTopicEvent::MessagePosted(_) => "channel.message_posted",
        ChannelTopicEvent::Mentioned(_) => "channel.mentioned",
        ChannelTopicEvent::MessagePatched(_) => "channel.message_patched",
        ChannelTopicEvent::MessageDeleted(_) => "channel.message_deleted",
        ChannelTopicEvent::MessageAttachmentCreated(_) => "channel.message_attachment_created",
        ChannelTopicEvent::MessageAttachmentRemoved(_) => "channel.message_attachment_removed",
        ChannelTopicEvent::ParticipantAdded(_) => "channel.participant_added",
        ChannelTopicEvent::ParticipantRemoved(_) => "channel.participant_removed",
    }
}
