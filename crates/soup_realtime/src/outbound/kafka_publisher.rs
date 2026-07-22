//! Kafka publisher for versioned realtime Soup messages.

#[cfg(test)]
mod test;

use macro_event_broker::EventPublisher;
use macro_event_topics::MacroSoupRealtimeTopic;
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::{models::SoupRealtimeMessage, ports::SoupRealtimePublisher};

/// Realtime Soup publisher backed by a byte-oriented event publisher.
pub struct KafkaSoupRealtimePublisher<P> {
    publisher: P,
}

impl<P> KafkaSoupRealtimePublisher<P> {
    /// Creates a realtime Soup Kafka publisher.
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }
}

impl<P> SoupRealtimePublisher for KafkaSoupRealtimePublisher<P>
where
    P: EventPublisher,
{
    #[tracing::instrument(
        skip(self, message),
        fields(user_id = %message.user_id),
        err
    )]
    async fn publish(&self, message: SoupRealtimeMessage) -> Result<(), Report> {
        let payload =
            serde_json::to_vec(&message).context("failed to serialize realtime Soup message")?;

        self.publisher
            .publish(MacroSoupRealtimeTopic, message.user_id.as_ref(), &payload)
            .await
            .context("failed to publish realtime Soup message")?;

        Ok(())
    }
}
