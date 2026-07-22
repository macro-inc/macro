//! Kafka adapter for the [`EventConsumer`] port.

use kafka_util::KafkaEventConsumer;
use rdkafka::message::{BorrowedMessage, Message as _};

use crate::{EventConsumer, MacroEventCollection, MessageWrapper};

/// Adapts a [`KafkaEventConsumer`] to the broker's [`EventConsumer`] port.
pub struct KafkaEventConsumerAdapter<T> {
    consumer: KafkaEventConsumer<T>,
}

impl<T> KafkaEventConsumerAdapter<T> {
    /// Creates an adapter around a configured Kafka consumer.
    pub fn new(consumer: KafkaEventConsumer<T>) -> Self {
        Self { consumer }
    }

    /// Borrows the underlying Kafka consumer.
    pub fn inner(&self) -> &KafkaEventConsumer<T> {
        &self.consumer
    }

    /// Returns the underlying Kafka consumer.
    pub fn into_inner(self) -> KafkaEventConsumer<T> {
        self.consumer
    }
}

impl<T, M> EventConsumer<M> for KafkaEventConsumerAdapter<T>
where
    T: Send + Sync + 'static,
    M: MacroEventCollection + 'static,
{
    type MessageType<'a> = BorrowedMessage<'a>;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, M>, rootcause::Report> {
        let message = self.consumer.recv().await?;

        tracing::trace!(
            topic = message.topic(),
            partition = message.partition(),
            offset = message.offset(),
            payload_len = message.payload().map_or(0, <[u8]>::len),
            "received Kafka event message"
        );

        Ok(MessageWrapper::new(message))
    }
}

#[cfg(test)]
mod test;
