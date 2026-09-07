//! Broker envelopes and publication for committed message facts.

use crate::domain::events::MessagePostedMetadata;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroMessagesTopic;
use serde::{Deserialize, Serialize};

/// Lifecycle events for the common message service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum MessageTopicEvent {
    /// A user or bot posted a root or reply.
    #[serde(rename = "message.posted")]
    Posted(MessagePostedMetadata),
}

impl TopicEvent for MessageTopicEvent {
    type Topic = MacroMessagesTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// Posted messages keyed by thread root to preserve conversation ordering.
#[derive(Debug, Clone)]
pub struct MessageMacroEvent {
    key: String,
    event: Event<MessageTopicEvent>,
}

impl MessageMacroEvent {
    /// Wrap a persisted post for publication.
    pub fn posted(message: MessagePostedMetadata) -> Self {
        Self {
            key: message.root_id().to_string(),
            event: Event::new(MessageTopicEvent::Posted(message)),
        }
    }
}

impl MacroEvent for MessageMacroEvent {
    type EventPayload = MessageTopicEvent;
    fn key(&self) -> &str {
        &self.key
    }
    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publishes committed posts to the common agent event stream.
#[derive(Clone)]
pub struct BrokerMessagePublisher<Broker> {
    broker: Broker,
}

impl<Broker> BrokerMessagePublisher<Broker> {
    /// Construct a broker sink for committed message facts.
    pub fn new(broker: Broker) -> Self {
        Self { broker }
    }
}

#[cfg(feature = "ports")]
impl<Broker: macro_event_broker::MacroEventBroker> crate::domain::ports::MessageEventPublisher
    for BrokerMessagePublisher<Broker>
{
    async fn publish(
        &self,
        event: crate::domain::ports::MessageEvent,
    ) -> Result<(), rootcause::Report> {
        // Enqueue the invocation independently of notification delivery: a notification
        // failure cannot prevent an otherwise committed prompt from reaching consumers.
        match &event.change {
            crate::domain::ports::MessageChange::Posted {
                message, mentions, ..
            } => self
                .broker
                .send_event(&MessageMacroEvent::posted(
                    MessagePostedMetadata::from_message(message, mentions.clone()),
                ))
                .map(|_| ())
                .map_err(|error| rootcause::report!(error).into()),
            _ => Ok(()),
        }
    }
}
