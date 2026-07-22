//! Kafka adapter for the [`EventConsumer`] port.

use std::{marker::PhantomData, time::Duration};

use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer, Ungrouped};
use rdkafka::message::{BorrowedMessage, Message as _};

use crate::{EventConsumer, MacroEventCollection, MessageWrapper};

pub struct KafkaConsumerAdapter<T, M> {
    inner: KafkaEventConsumer<T>,
    topics: PhantomData<M>,
}

impl<M: MacroEventCollection> KafkaConsumerAdapter<Ungrouped, M> {
    pub fn new(
        consumer: KafkaEventConsumer<Ungrouped>,
        initial_offset: InitialOffset,
        metadata_timeout: Duration,
    ) -> Result<Self, rootcause::Report> {
        consumer.assign_topics(M::topics(), initial_offset, metadata_timeout)?;
        Ok(KafkaConsumerAdapter {
            inner: consumer,
            topics: PhantomData,
        })
    }
}

impl<T: GroupName> KafkaConsumerAdapter<T, ()> {
    pub fn new(consumer: KafkaEventConsumer<T>) -> Self {
        KafkaConsumerAdapter {
            inner: consumer,
            topics: PhantomData,
        }
    }
}

impl<T: GroupName, M> KafkaConsumerAdapter<T, M> {
    pub fn subscribe<M2: MacroEventCollection>(
        self,
    ) -> Result<KafkaConsumerAdapter<T, M2>, rootcause::Report> {
        let KafkaConsumerAdapter { inner, topics } = self;
        inner.subscribe(M2::topics())?;
        Ok(KafkaConsumerAdapter {
            inner,
            topics: PhantomData,
        })
    }
}

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
