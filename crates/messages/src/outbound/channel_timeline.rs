//! Kafka transport for live channel timeline updates.

#[cfg(feature = "consumer")]
mod consumer;
#[cfg(test)]
mod test;

#[cfg(feature = "consumer")]
pub use consumer::ChannelTimelineTopic;

use macro_event_broker::{Event, EventBrokerError, MacroEvent, MacroEventBroker, TopicEvent};
use macro_event_topics::MacroChannelTimelineTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use tracing::Instrument as _;

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

/// Largest encoded change a record carries. Kafka refuses records over
/// 1,000,000 bytes by default, which leaves room for [`MAX_AUDIENCE_BYTES`]
/// and the envelope.
const MAX_UPDATE_BYTES: usize = 512 * 1024;
/// Most encoded recipients a record carries.
const MAX_AUDIENCE_BYTES: usize = 256 * 1024;
/// Quotes and comma around an encoded recipient.
const RECIPIENT_OVERHEAD_BYTES: usize = 3;

/// Publishes live channel timeline updates through the event broker.
///
/// No update is dropped for its size: a change too large for a record is
/// published as the hint that it happened, and an audience too large for one
/// is split across several.
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

impl<Broker: MacroEventBroker + Clone> BrokerChannelTimelinePublisher<Broker> {
    /// Schedule one record. One the broker refuses, such as for a topic set to
    /// smaller records than assumed here, is replaced by its hint; the broker
    /// logs every failed publish under the channel it is keyed by.
    fn send(&self, record: AddressedChannelTimelineUpdate) -> Result<(), EventBrokerError> {
        let delivery = self
            .broker
            .send_event(&ChannelTimelineMacroEvent::updated(record.clone()))?;
        let broker = self.broker.clone();
        tokio::spawn(
            async move {
                let Ok(Err(EventBrokerError::Publish(_))) = delivery.await else {
                    return;
                };
                let update = &record.update;
                if update.truncated {
                    return;
                }
                tracing::warn!(
                    channel_id = %update.channel_id,
                    seq = update.seq,
                    recipients = record.recipients.len(),
                    "channel timeline record was refused; its recipients catch up instead"
                );
                let hint = AddressedChannelTimelineUpdate {
                    update: update.hint(),
                    recipients: record.recipients,
                };
                let _ = broker
                    .send_event(&ChannelTimelineMacroEvent::updated(hint))
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "failed to send channel timeline hint");
                    });
            }
            .in_current_span(),
        );
        Ok(())
    }
}

/// Split recipients into runs that fit beside an update, in order.
fn audiences<'a>(
    recipients: &'a [MacroUserIdStr<'static>],
) -> impl Iterator<Item = &'a [MacroUserIdStr<'static>]> {
    let mut bytes = 0;
    recipients.chunk_by(move |_, next| {
        // A run counts its first recipient only from its second; the room left
        // beside a record's update and audience is far larger than one id.
        bytes += next.as_ref().len() + RECIPIENT_OVERHEAD_BYTES;
        let fits = bytes <= MAX_AUDIENCE_BYTES;
        if !fits {
            bytes = 0;
        }
        fits
    })
}

impl<Broker: MacroEventBroker + Clone> ChannelTimelineUpdatePublisher
    for BrokerChannelTimelinePublisher<Broker>
{
    type Err = EventBrokerError;

    fn publish(&self, addressed: &AddressedChannelTimelineUpdate) -> Result<(), Self::Err> {
        let update = &addressed.update;
        let bytes = serde_json::to_vec(update)?.len();
        let update = if bytes > MAX_UPDATE_BYTES {
            tracing::warn!(
                channel_id = %update.channel_id,
                seq = update.seq,
                bytes,
                "channel timeline update is too large to carry; its recipients catch up instead"
            );
            update.hint()
        } else {
            update.clone()
        };

        // One refused run must not cost the others their update.
        let mut first_error = None;
        for recipients in audiences(&addressed.recipients) {
            let sent = self.send(AddressedChannelTimelineUpdate {
                recipients: recipients.to_vec(),
                update: update.clone(),
            });
            if let Err(error) = sent {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}
