//! Port traits defining the broker's inbound and outbound boundaries.

use std::future::Future;

use macro_event_topics::Topic;

use crate::domain::models::{EventBrokerError, MacroEvent};

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
