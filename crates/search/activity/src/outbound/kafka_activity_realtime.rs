//! Kafka transport for addressed activity announcements.

use macro_event_broker::{Event, MacroEvent, MacroEventBroker};
use rootcause::prelude::{Report, ResultExt as _};
use tokio_util::task::AbortOnDropHandle;

use crate::domain::{
    events::{ActivityMacroEvent, ActivityTopicEvent},
    ports::ActivityEventPublisher,
};

/// Sends domain-selected activity announcements through the event broker.
pub struct KafkaActivityRealtimePublisher<B> {
    broker: B,
}

impl<B> KafkaActivityRealtimePublisher<B> {
    /// Creates the Kafka transport.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> ActivityEventPublisher for KafkaActivityRealtimePublisher<B> {
    type Err = Report;

    async fn publish(&self, event: ActivityTopicEvent) -> Result<(), Report> {
        let event = ActivityMacroEvent::from_event(event.key().to_owned(), Event::new(event));
        let publish = AbortOnDropHandle::new(
            self.broker
                .send_event(&event)
                .context("failed to dispatch activity Kafka event")?,
        );
        publish
            .await
            .context("activity Kafka publish task failed")?
            .context("failed to publish activity to Kafka")?;
        Ok(())
    }
}
