//! Typed producer and consumer services.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use tracing::Instrument as _;

use crate::MessageWrapper;
use crate::domain::models::{EventBrokerError, MacroEvent, TopicEvent};
use crate::domain::ports::{
    EventConsumer, EventPublisher, MacroEventBroker, MacroEventCollection, Spawner,
};

const PUBLISH_TIMEOUT: Duration = Duration::from_secs(6);

/// Receives transport messages associated with a declared macro event collection.
pub struct MacroEventConsumerService<M, C>
where
    M: MacroEventCollection,
    C: EventConsumer<M>,
{
    consumer: C,
    marker: PhantomData<fn() -> M>,
}

impl<M, C> MacroEventConsumerService<M, C>
where
    M: MacroEventCollection,
    C: EventConsumer<M>,
{
    /// Creates a typed consumer service backed by `consumer`.
    pub const fn new(consumer: C) -> Self {
        Self {
            consumer,
            marker: PhantomData,
        }
    }

    /// Receives the next message from the underlying consumer.
    ///
    /// Call [`MessageWrapper::decode_payload`] to decode its declared event.
    pub async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<C::MessageType<'a>, M>, rootcause::Report> {
        self.consumer.recv().await
    }

    /// Returns the underlying consumer.
    ///
    /// This provides access to transport-specific delivery operations after a
    /// message has been received through this service.
    pub const fn inner(&self) -> &C {
        &self.consumer
    }
}

/// Orchestrates serializing events and handing them to an [`EventPublisher`].
pub struct MacroEventBrokerService<P: EventPublisher, S: Spawner> {
    publisher: Arc<P>,
    spawner: S,
}

impl<P, S> Clone for MacroEventBrokerService<P, S>
where
    P: EventPublisher,
    S: Spawner + Clone,
{
    fn clone(&self) -> Self {
        Self {
            publisher: Arc::clone(&self.publisher),
            spawner: self.spawner.clone(),
        }
    }
}

impl<P: EventPublisher, S: Spawner> MacroEventBrokerService<P, S> {
    /// Creates a new service backed by the given outbound publisher and task spawner.
    pub fn new(publisher: P, spawner: S) -> Self {
        Self {
            publisher: Arc::new(publisher),
            spawner,
        }
    }
}

impl<P: EventPublisher, S: Spawner> MacroEventBroker for MacroEventBrokerService<P, S> {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let topic = event.topic();
        let key = event.key().to_owned();
        let payload = serde_json::to_vec(event.event())?;
        let publisher = Arc::clone(&self.publisher);
        let span = tracing::Span::current();

        let handle = self.spawner.spawn(
            async move {
                tokio::time::timeout(
                    PUBLISH_TIMEOUT,
                    publisher.publish::<<<E as MacroEvent>::EventPayload as TopicEvent>::Topic>(
                        &key, &payload,
                    ),
                )
                .await
                .map_err(|_| EventBrokerError::PublishTimeout {
                    timeout: PUBLISH_TIMEOUT,
                })
                .and_then(std::convert::identity)
                .inspect_err(|error| {
                    tracing::error!(
                        error = ?error,
                        topic,
                        key = %key,
                        "failed to publish event",
                    );
                })
            }
            .instrument(span),
        );

        Ok(handle)
    }
}

/// A [`MacroEventBroker`] that drops every event.
///
/// Useful as a default type parameter for services that publish events
/// optionally, and in tests that don't care about published events.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopMacroEventBroker;

impl MacroEventBroker for NoopMacroEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
