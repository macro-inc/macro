//! Kafka publisher for versioned realtime Soup messages.

#[cfg(test)]
mod test;

use macro_event_broker::{EventPublisher, TopicMessagePublisher as _};
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
        self.publisher
            .publish_message(&message)
            .await
            .context("failed to publish realtime Soup message")?;

        Ok(())
    }
}
