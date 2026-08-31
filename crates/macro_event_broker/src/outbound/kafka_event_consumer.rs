//! Kafka adapters for configuring topic-aware grouped and ungrouped consumers
//! and implementing the [`EventConsumer`] port.

use std::{marker::PhantomData, time::Duration};

use kafka_util::{GroupName, InitialOffset, KafkaEventConsumer, Ungrouped};
use rdkafka::{
    consumer::CommitMode,
    message::{BorrowedMessage, Message as _},
};

use crate::{EventConsumer, MacroEventCollection, MessageWrapper};

/// Topic-aware wrapper around a [`KafkaEventConsumer`].
///
/// `T` selects grouped or [`Ungrouped`] consumption. `M` records the
/// [`MacroEventCollection`] whose topics were assigned or subscribed, so the
/// configured topic set remains visible in the adapter's type.
pub struct KafkaConsumerAdapter<T, M> {
    inner: KafkaEventConsumer<T>,
    topics: PhantomData<fn() -> M>,
}

impl<M: MacroEventCollection> KafkaConsumerAdapter<Ungrouped, M> {
    /// Creates an ungrouped adapter and manually assigns every topic in `M`.
    ///
    /// Every current partition starts at `initial_offset`. Topic metadata must
    /// be fetched within `metadata_timeout`; failures are returned to the
    /// caller.
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
    /// Wraps a grouped consumer before its event topics are subscribed.
    pub fn new(consumer: KafkaEventConsumer<T>) -> Self {
        KafkaConsumerAdapter {
            inner: consumer,
            topics: PhantomData,
        }
    }
}

impl<T: GroupName, M> KafkaConsumerAdapter<T, M> {
    /// Subscribes the grouped consumer to every topic declared by `M2`.
    ///
    /// Kafka subscription is synchronous, replaces the previous subscription,
    /// and causes the group coordinator to rebalance asynchronously while the
    /// consumer is polled. The returned adapter records `M2` in its type.
    pub fn subscribe<M2: MacroEventCollection>(
        self,
    ) -> Result<KafkaConsumerAdapter<T, M2>, rootcause::Report> {
        let KafkaConsumerAdapter { inner, .. } = self;
        inner.subscribe(M2::topics())?;
        Ok(KafkaConsumerAdapter {
            inner,
            topics: PhantomData,
        })
    }

    /// Commits a message using the caller-selected commit mode.
    pub fn commit_message(
        &self,
        message: &BorrowedMessage<'_>,
        mode: CommitMode,
    ) -> Result<(), rootcause::Report> {
        Ok(self.inner.commit_message(message, mode)?)
    }
}

impl<T, M: MacroEventCollection> KafkaConsumerAdapter<T, M> {
    /// Pauses the partition containing `message`.
    ///
    /// Grouped consumers can use this to prevent a later cumulative commit
    /// from advancing past a failed record. Ungrouped consumers can use it to
    /// stop additional delivery from a failed partition.
    pub fn pause_message_partition(
        &self,
        message: &BorrowedMessage<'_>,
    ) -> Result<(), rootcause::Report> {
        Ok(self.inner.pause_message_partition(message)?)
    }
}

impl<T, M> EventConsumer<M> for KafkaConsumerAdapter<T, M>
where
    T: Send + Sync + 'static,
    M: MacroEventCollection + 'static,
{
    type MessageType<'a> = BorrowedMessage<'a>;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, M>, rootcause::Report> {
        let message = self.inner.recv().await?;

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
