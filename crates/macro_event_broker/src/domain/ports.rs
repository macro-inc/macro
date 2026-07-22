//! Port traits defining the broker's inbound and outbound boundaries.

use std::future::Future;

use macro_event_topics::Topic;

use crate::domain::models::{EventBrokerError, MacroEvent, TopicMessage};

/// Inbound port: the public API for sending events through the broker.
///
/// Implemented by [`MacroEventBrokerService`](crate::domain::service::MacroEventBrokerService).
pub trait MacroEventBroker: Send + Sync + 'static {
    /// Serialize `event` to JSON and schedule it for publication to the topic declared by its
    /// typed payload, keyed by [`MacroEvent::key`].
    ///
    /// Serialization errors are returned immediately. Publication runs in a spawned task, whose
    /// [`tokio::task::JoinHandle`] can be awaited when the caller needs to wait for completion and
    /// inspect publisher failures or timeouts. Task errors are also logged so callers may still
    /// use this method for fire-and-forget publication.
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError>;
}

/// Outbound port: the boundary to the underlying message broker (e.g. Kafka).
///
/// Kept byte-oriented so payload serialization stays the service's concern and the
/// port is trivial to mock or stub in tests. Application publishers should use
/// [`TopicMessagePublisher`] when publishing a [`TopicMessage`].
pub trait EventPublisher: Send + Sync + 'static {
    /// Publish a raw `payload` to `topic`, keyed by `key`.
    fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> impl Future<Output = Result<(), EventBrokerError>> + Send;
}

/// Typed publication extension for byte-oriented [`EventPublisher`] adapters.
pub trait TopicMessagePublisher: EventPublisher {
    /// Validate, serialize, and publish a message to its associated topic.
    fn publish_message<M: TopicMessage>(
        &self,
        message: &M,
    ) -> impl Future<Output = Result<(), EventBrokerError>> + Send {
        async move {
            let payload = message.encode()?;
            self.publish(M::Topic::default(), message.key(), &payload)
                .await
        }
    }
}

impl<P: EventPublisher> TopicMessagePublisher for P {}
