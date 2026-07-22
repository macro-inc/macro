//! Kafka adapter for the [`EventConsumer`] port.

use kafka_util::KafkaEventConsumer;
use rdkafka::message::{BorrowedMessage, Message as _};

use crate::{EventConsumer, MacroEventCollection, MessageWrapper};

impl<T, M> EventConsumer<M> for KafkaEventConsumer<T>
where
    T: Send + Sync + 'static,
    M: MacroEventCollection + 'static,
{
    type MessageType<'a> = BorrowedMessage<'a>;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, M>, rootcause::Report> {
        let message = KafkaEventConsumer::recv(self).await?;

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
