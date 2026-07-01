use macro_event_broker::{
    Event, EventBrokerError, EventPublisher, MacroEvent, MacroEventBroker, MacroEventBrokerService,
    TopicEvent,
};
use macro_event_topics::{MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};

/// Publisher used by the example. Real services should use the Kafka adapter.
pub struct ExampleEventPublisher;

impl EventPublisher for ExampleEventPublisher {
    async fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        println!(
            "publishing topic={} key={} payload={}",
            topic.as_str(),
            key,
            String::from_utf8_lossy(payload)
        );
        Ok(())
    }
}

/// Metadata for [`ExampleTopicEvent::Created`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExampleCreatedMetadata {
    /// Human-readable name for the example event.
    pub name: String,
    /// Example count value.
    pub count: u32,
}

/// Metadata for [`ExampleTopicEvent::Updated`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExampleUpdatedMetadata {
    /// Updated count value.
    pub count: String,
}

/// Events that can be published to [`MacroExampleTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ExampleTopicEvent {
    /// Example creation event.
    #[serde(rename = "example.created")]
    Created(ExampleCreatedMetadata),
    /// Example update event.
    #[serde(rename = "example.updated")]
    Updated(ExampleUpdatedMetadata),
}

impl TopicEvent for ExampleTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable event for [`MacroExampleTopic`].
pub struct ExampleMacroEvent {
    key: String,
    event: Event<ExampleTopicEvent>,
}

impl ExampleMacroEvent {
    /// Build a created event.
    pub fn created(key: impl Into<String>, metadata: ExampleCreatedMetadata) -> Self {
        Self::new(key, ExampleTopicEvent::Created(metadata))
    }

    /// Build an updated event.
    pub fn updated(key: impl Into<String>, metadata: ExampleUpdatedMetadata) -> Self {
        Self::new(key, ExampleTopicEvent::Updated(metadata))
    }

    /// Build an event from a topic-specific event variant.
    pub fn new(key: impl Into<String>, event: ExampleTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<ExampleTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for ExampleMacroEvent {
    type EventPayload = ExampleTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}

/// Consumer-specific event enum for a consumer that subscribes to `macro.example`.
pub enum ExampleConsumerEvent {
    /// Event received on [`MacroExampleTopic`].
    Example(ExampleMacroEvent),
}

impl ExampleConsumerEvent {
    /// Decode one Kafka message into this consumer's event enum.
    pub fn decode(topic: &str, key: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        match topic {
            topic if topic == MacroExampleTopic.as_str() => {
                Ok(Self::Example(ExampleMacroEvent::decode(key, payload)?))
            }
            unknown => Err(EventBrokerError::UnknownTopic(unknown.to_string())),
        }
    }
}

#[tokio::main]
pub async fn main() -> Result<(), EventBrokerError> {
    let service = MacroEventBrokerService::new(ExampleEventPublisher);
    let event = ExampleMacroEvent::created(
        "example-123",
        ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        },
    );

    service.send_event(&event).await?;

    Ok(())
}
