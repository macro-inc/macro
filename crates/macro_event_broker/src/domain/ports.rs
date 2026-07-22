//! Port traits defining the broker's inbound and outbound boundaries.

use std::{future::Future, marker::PhantomData};

use macro_event_topics::Topic;

use crate::domain::models::{EventBrokerError, MacroEvent};

#[cfg(test)]
mod test;

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

/// A broker message paired with the type of event collection it can decode.
pub struct MessageWrapper<T, M> {
    inner: T,
    marker: PhantomData<M>,
}

impl<T, M> MessageWrapper<T, M> {
    /// Wraps the transport-specific message.
    pub fn new(inner: T) -> Self {
        Self {
            inner,
            marker: PhantomData,
        }
    }

    /// Borrows the transport-specific message.
    pub fn inner(&self) -> &T {
        &self.inner
    }

    /// Returns the transport-specific message.
    pub fn into_inner(self) -> T {
        self.inner
    }
}

/// A collection of [`MacroEvent`] types that can decode a broker message.
pub trait MacroEventCollection: Sized {
    /// Decodes an event from the supplied broker message.
    fn decode<T: MessageParts>(message: &T) -> Result<Self, EventBrokerError>;
}

/// Declares the [`MacroEvent`] types accepted by a consumer.
///
/// The macro creates a `DeclaredMacroEvent` enum with one variant per supplied
/// event type and implements topic-based decoding for it. Event types must be
/// identifiers and must implement [`MacroEvent`].
#[macro_export]
macro_rules! declare_topics {
    ($($event:ident),+ $(,)?) => {
        /// An event decoded from one of the topics declared by `declare_topics!`.
        pub enum DeclaredMacroEvent {
            $(
                #[doc = concat!("A decoded `", stringify!($event), "` event.")]
                $event($event),
            )+
        }

        impl $crate::MacroEventCollection for DeclaredMacroEvent {
            fn decode<T: $crate::MessageParts>(
                message: &T,
            ) -> Result<Self, $crate::EventBrokerError> {
                $(
                    if message.topic() == $crate::Topic::as_str(
                        &<<<$event as $crate::MacroEvent>::EventPayload as $crate::TopicEvent>::Topic as Default>::default(),
                    ) {
                        return <$event as $crate::MacroEvent>::decode(
                            message.key(),
                            message.payload(),
                        )
                        .map(DeclaredMacroEvent::$event);
                    }
                )+

                Err($crate::EventBrokerError::UnknownTopic(message.topic().to_owned()))
            }
        }
    };
}

impl<T: MessageParts, M: MacroEventCollection> MessageWrapper<T, M> {
    /// Decodes the message into one of the declared event types.
    pub fn decode_payload(&self) -> Result<M, EventBrokerError> {
        M::decode(&self.inner)
    }
}

/// Broker message fields needed to decode a [`MacroEvent`].
pub trait MessageParts {
    /// Returns the broker message key.
    fn key(&self) -> &str;

    /// Returns the serialized event payload.
    fn payload(&self) -> &[u8];

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
