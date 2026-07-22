//! Domain models for the event broker.

use macro_event_topics::Topic;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

/// A directly serialized message that is statically bound to one [`Topic`].
///
/// Unlike [`TopicEvent`], a topic message is not wrapped in an [`Event`]
/// envelope. Its associated topic drives both typed publication and typed
/// consumption, preventing those paths from selecting a topic independently of
/// the payload type.
pub trait TopicMessage: Serialize + DeserializeOwned + Send + Sync + Sized {
    /// The only topic to which this message type may be published.
    type Topic: Topic;

    /// Kafka record key used when publishing this message.
    fn key(&self) -> &str;

    /// Validates message-specific wire-contract invariants.
    fn validate(&self) -> Result<(), String> {
        Ok(())
    }

    /// Serializes and validates this message for typed publication.
    fn encode(&self) -> Result<Vec<u8>, EventBrokerError> {
        self.validate()
            .map_err(|reason| EventBrokerError::InvalidMessage {
                topic: Self::Topic::default().as_str(),
                reason,
            })?;
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserializes a message only when `topic` matches its associated topic.
    fn decode(topic: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        let expected_topic = Self::Topic::default();
        if topic != expected_topic.as_str() {
            return Err(EventBrokerError::UnknownTopic(topic.to_string()));
        }

        let message: Self = serde_json::from_slice(payload)?;
        message
            .validate()
            .map_err(|reason| EventBrokerError::InvalidMessage {
                topic: expected_topic.as_str(),
                reason,
            })?;
        Ok(message)
    }
}

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

    /// Kafka topic this event belongs to.
    pub fn topic(&self) -> E::Topic {
        E::Topic::default()
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

    /// Kafka topic this event should be published to.
    fn topic(&self) -> <Self::EventPayload as TopicEvent>::Topic {
        <<Self as MacroEvent>::EventPayload as TopicEvent>::Topic::default()
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
    /// The Kafka topic name is not handled by a consumer-specific event enum.
    #[error("unknown event topic: {0}")]
    UnknownTopic(String),
    /// A typed topic message violated its wire-contract invariants.
    #[error("invalid message for topic {topic}: {reason}")]
    InvalidMessage {
        /// Topic associated with the typed message.
        topic: &'static str,
        /// Description of the violated invariant.
        reason: String,
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

#[cfg(test)]
mod test;
