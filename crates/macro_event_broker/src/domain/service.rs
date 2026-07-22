//! Typed producer and consumer services.

#[cfg(test)]
mod test;

use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use macro_event_topics::Topic as _;
use tracing::Instrument as _;

use crate::domain::models::{EventBrokerError, MacroEvent, TopicEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

const PUBLISH_TIMEOUT: Duration = Duration::from_secs(6);

/// Transport-independent decoder for one statically associated event topic.
///
/// `E` determines the only accepted topic through
/// [`MacroEvent::EventPayload`] and [`TopicEvent::Topic`]. Kafka adapters can
/// use [`Self::topic_name`] when subscribing or assigning partitions, then pass
/// each raw record through [`Self::decode`].
pub struct MacroEventConsumerService<E> {
    marker: PhantomData<fn() -> E>,
}

impl<E> MacroEventConsumerService<E> {
    /// Creates a single-topic typed consumer service.
    pub const fn new() -> Self {
        Self {
            marker: PhantomData,
        }
    }
}

impl<E> Default for MacroEventConsumerService<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: MacroEvent> MacroEventConsumerService<E> {
    /// Returns the statically associated topic for `E`.
    pub fn topic() -> <E::EventPayload as TopicEvent>::Topic {
        <E::EventPayload as TopicEvent>::Topic::default()
    }

    /// Returns the Kafka topic name statically associated with `E`.
    pub fn topic_name() -> &'static str {
        Self::topic().as_str()
    }

    /// Validates and decodes one raw record from the associated topic.
    ///
    /// The actual topic must match [`Self::topic_name`]. The envelope's schema
    /// version must also match the version declared by its decoded typed event
    /// payload.
    #[tracing::instrument(skip(self, payload), fields(expected_topic = Self::topic_name(), payload_len = payload.len()), err)]
    pub fn decode(&self, topic: &str, key: &str, payload: &[u8]) -> Result<E, EventBrokerError> {
        let expected_topic = Self::topic_name();
        if topic != expected_topic {
            return Err(EventBrokerError::UnknownTopic(topic.to_string()));
        }

        let event = E::decode(key, payload)?;
        let expected = event.event().event.schema_version();
        let actual = event.event().schema_version;
        if actual != expected {
            return Err(EventBrokerError::UnsupportedSchemaVersion {
                topic: expected_topic,
                expected,
                actual,
            });
        }

        Ok(event)
    }
}

/// Orchestrates serializing events and handing them to an [`EventPublisher`].
pub struct MacroEventBrokerService<P: EventPublisher> {
    publisher: Arc<P>,
}

impl<P: EventPublisher> Clone for MacroEventBrokerService<P> {
    fn clone(&self) -> Self {
        Self {
            publisher: Arc::clone(&self.publisher),
        }
    }
}

impl<P: EventPublisher> MacroEventBrokerService<P> {
    /// Create a new service backed by the given outbound publisher.
    pub fn new(publisher: P) -> Self {
        Self {
            publisher: Arc::new(publisher),
        }
    }
}

impl<P: EventPublisher> MacroEventBroker for MacroEventBrokerService<P> {
    #[tracing::instrument(err, skip(self, event), fields(topic = %event.topic().as_str(), key = %event.key()))]
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let topic = event.topic();
        let key = event.key().to_owned();
        let payload = serde_json::to_vec(event.event())?;
        let publisher = Arc::clone(&self.publisher);
        let span = tracing::Span::current();

        let handle = tokio::spawn(
            async move {
                tokio::time::timeout(PUBLISH_TIMEOUT, publisher.publish(topic, &key, &payload))
                    .await
                    .map_err(|_| EventBrokerError::PublishTimeout {
                        timeout: PUBLISH_TIMEOUT,
                    })
                    .and_then(std::convert::identity)
                    .inspect_err(|error| {
                        tracing::error!(
                            error = ?error,
                            topic = topic.as_str(),
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
