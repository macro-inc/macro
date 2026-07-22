use macro_event_topics::{MacroDocumentsTopic, MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExampleCreatedMetadata {
    name: String,
    count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
enum ExampleTopicEvent {
    #[serde(rename = "example.created")]
    Created(ExampleCreatedMetadata),
}

impl TopicEvent for ExampleTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExampleTopicMessage {
    schema_version: u8,
    key: String,
    value: String,
}

impl TopicMessage for ExampleTopicMessage {
    type Topic = MacroExampleTopic;

    fn key(&self) -> &str {
        &self.key
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version == 1 {
            Ok(())
        } else {
            Err(format!(
                "unsupported schema version {}",
                self.schema_version
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExampleMacroEvent {
    key: String,
    event: Event<ExampleTopicEvent>,
}

impl ExampleMacroEvent {
    fn with_event(key: impl Into<String>, event: Event<ExampleTopicEvent>) -> Self {
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

enum ExampleConsumerEvent {
    Example(ExampleMacroEvent),
}

impl ExampleConsumerEvent {
    fn decode(topic: &str, key: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        match topic {
            topic if topic == MacroExampleTopic.as_str() => {
                Ok(Self::Example(ExampleMacroEvent::decode(key, payload)?))
            }
            unknown => Err(EventBrokerError::UnknownTopic(unknown.to_string())),
        }
    }
}

fn example_event() -> Event<ExampleTopicEvent> {
    Event::with_event_id(
        Uuid::from_u128(1),
        ExampleTopicEvent::Created(ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        }),
    )
}

#[test]
fn topic_message_round_trips_through_its_associated_topic() {
    let message = ExampleTopicMessage {
        schema_version: 1,
        key: "message-key".to_string(),
        value: "hello".to_string(),
    };

    let payload = message.encode().expect("message encodes");
    let decoded = ExampleTopicMessage::decode(MacroExampleTopic.as_str(), &payload)
        .expect("associated topic decodes");

    assert_eq!(decoded, message);
    assert_eq!(decoded.key(), "message-key");
}

#[test]
fn topic_message_rejects_a_different_topic() {
    let message = ExampleTopicMessage {
        schema_version: 1,
        key: "message-key".to_string(),
        value: "hello".to_string(),
    };
    let payload = message.encode().expect("message encodes");

    assert!(matches!(
        ExampleTopicMessage::decode(MacroDocumentsTopic.as_str(), &payload),
        Err(EventBrokerError::UnknownTopic(topic)) if topic == MacroDocumentsTopic.as_str()
    ));
}

#[test]
fn topic_message_validates_on_encode_and_decode() {
    let invalid = ExampleTopicMessage {
        schema_version: 2,
        key: "message-key".to_string(),
        value: "hello".to_string(),
    };

    assert!(matches!(
        invalid.encode(),
        Err(EventBrokerError::InvalidMessage { topic, .. }) if topic == MacroExampleTopic.as_str()
    ));

    let payload = serde_json::to_vec(&invalid).expect("raw message serializes");
    assert!(matches!(
        ExampleTopicMessage::decode(MacroExampleTopic.as_str(), &payload),
        Err(EventBrokerError::InvalidMessage { topic, .. }) if topic == MacroExampleTopic.as_str()
    ));
}

#[test]
fn event_serializes_to_tagged_wire_shape() {
    let event = example_event();

    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "example.created",
            "metadata": {
                "name": "hello",
                "count": 7,
            },
        })
    );
}

#[test]
fn macro_event_decodes_from_payload() {
    let event = example_event();
    let payload = serde_json::to_vec(&event).unwrap();

    let decoded = ExampleMacroEvent::decode("msg-123", &payload).unwrap();

    assert_eq!(decoded.key(), "msg-123");
    assert_eq!(decoded.event(), &event);
}

#[test]
fn consumer_specific_enum_decodes_by_topic() {
    let event = example_event();
    let payload = serde_json::to_vec(&event).unwrap();

    let decoded = ExampleConsumerEvent::decode(MacroExampleTopic.as_str(), "msg-123", &payload)
        .expect("topic should decode");

    let ExampleConsumerEvent::Example(decoded) = decoded;
    assert_eq!(decoded.key(), "msg-123");
}
