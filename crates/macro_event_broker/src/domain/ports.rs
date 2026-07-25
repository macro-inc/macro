//! Port traits defining the broker's inbound and outbound boundaries.

use macro_event_topics::Topic;

use crate::domain::models::{EventBrokerError, MacroEvent, MessageWrapper};

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
    /// Publishes a raw `payload` to [`T::TOPIC_STR`](Topic::TOPIC_STR), keyed by `key`.
    fn publish<T: Topic>(
        &self,
        key: &str,
        payload: &[u8],
    ) -> impl Future<Output = Result<(), EventBrokerError>> + Send;
}

/// A collection of [`MacroEvent`] types that can decode a broker message.
pub trait MacroEventCollection: Sized {
    /// Decodes an event from the supplied broker message.
    fn decode<T: MessageParts>(message: &T) -> Result<Self, EventBrokerError>;

    /// Lists the statically known topics in this event collection.
    fn topics() -> &'static [&'static str];
}

/// Broker message fields needed to decode a [`MacroEvent`].
pub trait MessageParts {
    /// Returns the broker message key.
    fn key(&self) -> Option<&str>;

    /// Returns the serialized event payload.
    fn payload(&self) -> Option<&[u8]>;

    /// Returns the broker topic name.
    fn topic(&self) -> &str;
}

/// Inbound boundary for receiving messages from the event broker.
pub trait EventConsumer<M: MacroEventCollection>: Send + Sync + 'static {
    /// The concrete transport-specific message type.
    type MessageType<'a>: MessageParts
    where
        Self: 'a;

    /// Waits for and returns the next broker message.
    fn recv<'a>(
        &'a self,
    ) -> impl Future<Output = Result<MessageWrapper<Self::MessageType<'a>, M>, rootcause::Report>>
    + Send
    + 'a;
}
