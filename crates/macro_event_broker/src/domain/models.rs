//! Domain models for the event broker.

use std::marker::PhantomData;

use macro_event_topics::Topic;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::domain::ports::{MacroEventCollection, MessageParts};

/// Event payload enum for a single [`Topic`].
///
/// Implement this trait for each topic-specific event enum. The enum should use
/// `#[serde(tag = "event_type", content = "metadata")]` so the wire payload is
/// self-describing while each variant still carries strongly typed metadata.
pub trait TopicEvent: Serialize + DeserializeOwned + Send + Sync {
    /// The concrete topic type that all variants of this event enum belong to.
    type Topic: Topic;

    /// Version of this concrete event variant's payload schema.
    fn schema_version(&self) -> u8;
}

/// Serializable event envelope published through the broker.
///
/// The envelope carries broker-agnostic information that is useful to downstream
/// consumers. The topic-specific event enum is flattened so the wire shape stays:
/// `event_id`, `schema_version`, `event_type`, and `metadata`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event<E> {
    /// Unique identifier for this event instance.
    pub event_id: Uuid,
    /// Version of the event payload schema.
    pub schema_version: u8,
    /// Topic-specific event variant and strongly typed metadata.
    #[serde(flatten)]
    pub event: E,
}

impl<E: TopicEvent> Event<E> {
    /// Create a new event with a generated UUIDv7 event id.
    pub fn new(event: E) -> Self {
        Self::with_event_id(Uuid::now_v7(), event)
    }

    /// Create a new event with a generated UUIDv7 event id and explicit schema version.
    pub fn with_schema_version(event: E, schema_version: u8) -> Self {
        Self::with_event_id_and_schema_version(Uuid::now_v7(), schema_version, event)
    }

    /// Create a new event with an explicit event id.
    pub fn with_event_id(event_id: Uuid, event: E) -> Self {
        let schema_version = event.schema_version();
        Self::with_event_id_and_schema_version(event_id, schema_version, event)
    }

    /// Create a new event with an explicit event id and schema version.
    pub fn with_event_id_and_schema_version(event_id: Uuid, schema_version: u8, event: E) -> Self {
        Self {
            event_id,
            schema_version,
            event,
        }
    }

    /// Deserialize an event envelope from JSON payload bytes.
    pub fn decode(payload: &[u8]) -> Result<Self, EventBrokerError> {
        Ok(serde_json::from_slice(payload)?)
    }

    /// Broker topic this event belongs to.
    pub fn topic(&self) -> &'static str {
        E::Topic::TOPIC_STR
    }
}

/// Domain event that can be routed through the macro event broker.
///
/// Application code should define concrete types implementing this trait. Those
/// types own the broker key plus the typed [`Event`] envelope, keeping Kafka
/// routing metadata separate from the serialized payload.
pub trait MacroEvent: Send + Sync {
    /// Topic-specific event enum carried by this macro event.
    type EventPayload: TopicEvent;

    /// Broker topic this event should be published to.
    fn topic(&self) -> &'static str {
        <Self::EventPayload as TopicEvent>::Topic::TOPIC_STR
    }

    /// Kafka message key used for partitioning and compaction.
    fn key(&self) -> &str;

    /// Serializable event envelope to publish.
    fn event(&self) -> &Event<Self::EventPayload>;

    /// Build this macro event from the Kafka message key and deserialized event envelope.
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self
    where
        Self: Sized;

    /// Decode this macro event from the Kafka message key and JSON payload bytes.
    fn decode<K: Into<String>>(key: K, payload: &[u8]) -> Result<Self, EventBrokerError>
    where
        Self: Sized,
    {
        Ok(Self::from_event(key.into(), Event::decode(payload)?))
    }
}

/// Errors that can occur when publishing or consuming an event.
#[derive(Debug, thiserror::Error)]
pub enum EventBrokerError {
    /// The event payload could not be serialized to or deserialized from JSON.
    #[error("failed to serialize or deserialize event payload")]
    Serialization(#[from] serde_json::Error),
    /// The consumed broker message did not include a key.
    #[error("event broker message is missing a key")]
    MissingMessageKey,
    /// The consumed broker message did not include a payload.
    #[error("event broker message is missing a payload")]
    MissingMessagePayload,
    /// The Kafka topic name is not handled by a consumer-specific event enum.
    #[error("unknown event topic: {0}")]
    UnknownTopic(String),
    /// The event envelope schema version is not supported by its typed payload.
    #[error("unsupported schema version {actual} for topic {topic}; expected {expected}")]
    UnsupportedSchemaVersion {
        /// Topic carrying the event.
        topic: &'static str,
        /// Schema version declared by the typed event payload.
        expected: u8,
        /// Schema version found in the decoded envelope.
        actual: u8,
    },
    /// The broker rejected or failed to deliver the message.
    #[error("failed to publish event: {0}")]
    Publish(String),
    /// Publishing did not complete within the configured timeout.
    #[error("event publish timed out after {timeout:?}")]
    PublishTimeout {
        /// Maximum duration allowed for publication.
        timeout: std::time::Duration,
    },
    /// An otherwise-unclassified internal error.
    #[error("internal event broker error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for EventBrokerError {
    fn from(report: rootcause::Report) -> Self {
        EventBrokerError::Internal(report)
    }
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

impl<T: MessageParts, M: MacroEventCollection> MessageWrapper<T, M> {
    /// Decodes the message into one of the declared event types.
    pub fn decode_payload(&self) -> Result<M, EventBrokerError> {
        M::decode(&self.inner)
    }
}

/// Declares the [`MacroEvent`] types accepted by a consumer.
///
/// The first identifier names the generated event collection enum. Each
/// identifier after the colon becomes a variant and must implement
/// [`MacroEvent`]. The generated enum implements topic-based decoding.
///
/// ```text
/// declare_topics!(ConsumerEvents: DocumentMacroEvent, ChannelMacroEvent);
/// ```
#[macro_export]
macro_rules! declare_topics {
    ($collection:ident: $($event:ident),+ $(,)?) => {
        #[doc = concat!(
            "An event decoded from one of the topics declared for `",
            stringify!($collection),
            "`."
        )]
        pub enum $collection {
            $(
                #[doc = concat!("A decoded `", stringify!($event), "` event.")]
                $event($event),
            )+
        }

        impl $crate::MacroEventCollection for $collection {
            fn decode<T: $crate::MessageParts>(
                message: &T,
            ) -> Result<Self, $crate::EventBrokerError> {
                $(
                    let expected_topic =
                        <<<$event as $crate::MacroEvent>::EventPayload as $crate::TopicEvent>::Topic as $crate::Topic>::TOPIC_STR;
                    if message.topic() == expected_topic {
                        let key = message
                            .key()
                            .ok_or($crate::EventBrokerError::MissingMessageKey)?;
                        let payload = message
                            .payload()
                            .ok_or($crate::EventBrokerError::MissingMessagePayload)?;
                        let event = <$event as $crate::MacroEvent>::decode(key, payload)?;
                        let envelope = <$event as $crate::MacroEvent>::event(&event);
                        let expected = $crate::TopicEvent::schema_version(&envelope.event);
                        let actual = envelope.schema_version;
                        if actual != expected {
                            return Err($crate::EventBrokerError::UnsupportedSchemaVersion {
                                topic: expected_topic,
                                expected,
                                actual,
                            });
                        }
                        return Ok($collection::$event(event));
                    }
                )+

                Err($crate::EventBrokerError::UnknownTopic(message.topic().to_owned()))
            }

            fn topics() -> &'static [&'static str] {
                &[
                    $(
                        <<<$event as $crate::MacroEvent>::EventPayload as $crate::TopicEvent>::Topic as $crate::Topic>::TOPIC_STR,
                    )+
                ]
            }
        }
    };
}

#[cfg(test)]
mod test;
