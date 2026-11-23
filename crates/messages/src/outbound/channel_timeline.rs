//! Kafka transport for live channel timeline updates.

#[cfg(feature = "consumer")]
mod consumer;
#[cfg(test)]
mod test;

#[cfg(feature = "consumer")]
pub use consumer::ChannelTimelineTopicConsumer;

use macro_event_broker::{Event, EventBrokerError, MacroEvent, TopicEvent};
use macro_event_topics::MacroChannelTimelineTopic;
use serde::{Deserialize, Serialize};

use crate::domain::timeline_updates::{
    AddressedChannelTimelineUpdate, ChannelTimelineUpdatePublisher,
};

/// Events on the channel timeline topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ChannelTimelineTopicEvent {
    /// A committed channel change, hydrated and addressed to its participants.
    #[serde(rename = "channel_timeline.updated")]
    Updated(AddressedChannelTimelineUpdate),
}

impl TopicEvent for ChannelTimelineTopicEvent {
    type Topic = MacroChannelTimelineTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// A channel timeline event keyed by channel, so one channel's updates share
/// a partition and arrive in publication order.
#[derive(Debug, Clone)]
pub struct ChannelTimelineMacroEvent {
    key: String,
    event: Event<ChannelTimelineTopicEvent>,
}

impl ChannelTimelineMacroEvent {
    /// Wrap an addressed update for publication.
    pub fn updated(update: AddressedChannelTimelineUpdate) -> Self {
        Self {
            key: update.update.channel_id.to_string(),
            event: Event::new(ChannelTimelineTopicEvent::Updated(update)),
        }
    }

    /// The topic event this envelope carries.
    pub fn into_topic_event(self) -> ChannelTimelineTopicEvent {
        self.event.event
    }
}

impl MacroEvent for ChannelTimelineMacroEvent {
    type EventPayload = ChannelTimelineTopicEvent;
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

/// Publishes live channel timeline updates through the event broker.
#[derive(Clone)]
pub struct BrokerChannelTimelinePublisher<Broker> {
    broker: Broker,
}

impl<Broker> BrokerChannelTimelinePublisher<Broker> {
    /// Publish through `broker`.
    pub fn new(broker: Broker) -> Self {
        Self { broker }
    }
}

impl<Broker: macro_event_broker::MacroEventBroker> ChannelTimelineUpdatePublisher
    for BrokerChannelTimelinePublisher<Broker>
{
    type Err = EventBrokerError;

    fn publish(&self, update: &AddressedChannelTimelineUpdate) -> Result<(), Self::Err> {
        self.broker
            .send_event(&ChannelTimelineMacroEvent::updated(update.clone()))
            .map(drop)
    }
}
