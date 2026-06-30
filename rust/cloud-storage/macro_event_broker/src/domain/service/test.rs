use std::sync::Mutex;

use macro_event_topics::{MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::*;
use crate::domain::models::{Event, EventBrokerError, MacroEvent, TopicEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

/// A captured publish call: topic, key, and raw payload bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Published {
    topic: String,
    key: String,
    payload: Vec<u8>,
}

/// In-memory publisher that records every call instead of hitting a broker.
#[derive(Default)]
struct RecordingPublisher {
    calls: Mutex<Vec<Published>>,
}

impl EventPublisher for RecordingPublisher {
    async fn publish<T: Topic>(
        &self,
        topic: T,
        key: &str,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.calls.lock().unwrap().push(Published {
            topic: topic.as_str().to_string(),
            key: key.to_string(),
            payload: payload.to_vec(),
        });
        Ok(())
    }
}

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

    const TOPIC: Self::Topic = MacroExampleTopic;

    fn schema_version(&self) -> u16 {
        1
    }
}

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

#[tokio::test]
async fn send_event_serializes_and_routes() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default());
    let envelope = Event::with_event_id(
        Uuid::from_u128(1),
        ExampleTopicEvent::Created(ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        }),
    );
    let event = ExampleMacroEvent::with_event("msg-123", envelope.clone());

    service
        .send_event(&event)
        .await
        .expect("publish should succeed");

    let calls = service.publisher.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.topic, MacroExampleTopic.as_str());
    assert_eq!(call.key, "msg-123");
    assert_eq!(call.payload, serde_json::to_vec(&envelope).unwrap());
}
