//! The committed-post events a trigger consumer reads, and how each becomes
//! the one shape the trigger evaluates.
//!
//! `message.posted` on `macro.messages` is the source of record: it carries the
//! persisted parent, so a mention in a document discussion routes like one in a
//! channel. The consumer also reads `macro.properties` for task assignments.

#[cfg(test)]
mod test;

use super::processing::TriggerInput;
use super::task_assignment::TaskAssignment;
use macro_event_broker::{MacroEvent as _, MacroEventCollection};
use macro_uuid::Uuid;
use messages::outbound::broker::{MessageMacroEvent, MessageTopicEvent};
use properties::domain::events::{PropertyMacroEvent, PropertyTopicEvent};

macro_event_broker::declare_topics!(MessageTriggerEvents: MessageMacroEvent, PropertyMacroEvent);

/// A decoded broker record from the trigger source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTrigger {
    /// Broker event id, for tracing.
    pub event_id: Uuid,
    /// Wire name of the decoded event.
    pub event_type: &'static str,
    /// The committed post, when the record was one; other facts on the topic
    /// carry no trigger.
    pub posted: Option<TriggerInput>,
    /// Newly assigned agents, from a task assignment property update.
    pub assignment: Option<TaskAssignment>,
}

/// A topic collection whose records may carry a committed post.
pub trait TriggerEvents: MacroEventCollection + Send + 'static {
    /// Reduce a decoded record to the post it carries, if any.
    fn into_trigger(self) -> DecodedTrigger;
}

impl TriggerEvents for MessageTriggerEvents {
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
