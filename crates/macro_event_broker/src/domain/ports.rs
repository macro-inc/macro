//! Port traits defining the broker's inbound and outbound boundaries.

use std::future::Future;

use macro_event_topics::Topic;

use crate::domain::models::{EventBrokerError, MacroEvent};

/// Inbound port: the public API for sending events through the broker.
///
/// Implemented by [`MacroEventBrokerService`](crate::domain::service::MacroEventBrokerService).
pub trait MacroEventBroker: Send + Sync + 'static {
    /// Serialize `event` to JSON and publish it to the topic declared by its typed payload,
    /// keyed by [`MacroEvent::key`].
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> impl Future<Output = Result<(), EventBrokerError>> + Send;
}

/// Outbound port: the boundary to the underlying message broker (e.g. Kafka).
///
/// Kept byte-oriented so payload serialization stays the service's concern and the
/// port is trivial to mock or stub in tests.
pub trait EventPublisher: Send + Sync + 'static {
    /// Publish a raw `payload` to `topic`, keyed by `key`.
    fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> impl Future<Output = Result<(), EventBrokerError>> + Send;
}
