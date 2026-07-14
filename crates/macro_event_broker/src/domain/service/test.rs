use std::sync::{Arc, Mutex};

use macro_event_topics::{MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Event, EventBrokerError, MacroEvent, TopicEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

/// A captured publish call: topic, key, and raw payload bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Published {
    topic: &'static str,
    key: String,
    payload: Vec<u8>,
}

/// In-memory publisher that records every call instead of hitting a broker.
#[derive(Default)]
struct RecordingPublisher {
    calls: Mutex<Vec<Published>>,
}

impl EventPublisher for RecordingPublisher {
    async fn publish(
        &self,
        topic: &'static str,
        key: &str,
        payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.calls.lock().unwrap().push(Published {
            topic,
            key: key.to_string(),
            payload: payload.to_vec(),
        });
        Ok(())
    }
}

struct NotifyControlledPublisher {
    publish_started: Arc<Notify>,
    complete_delivery: Arc<Notify>,
    failure_message: Option<&'static str>,
}

impl EventPublisher for NotifyControlledPublisher {
    async fn publish(
        &self,
        _topic: &'static str,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.publish_started.notify_one();
        self.complete_delivery.notified().await;

        if let Some(message) = self.failure_message {
            return Err(EventBrokerError::Publish(message.to_string()));
        }

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

    fn schema_version(&self) -> u8 {
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

fn example_macro_event() -> ExampleMacroEvent {
    let envelope = Event::with_event_id(
        Uuid::from_u128(1),
        ExampleTopicEvent::Created(ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        }),
    );

    ExampleMacroEvent::with_event("msg-123", envelope)
}

#[tokio::test]
async fn send_event_serializes_and_routes() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default());
    let event = example_macro_event();

    service
        .send_event(&event)
        .await
        .expect("publish should succeed");

    let calls = service.publisher.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.topic, MacroExampleTopic.as_str());
    assert_eq!(call.key, "msg-123");
    assert_eq!(call.payload, serde_json::to_vec(event.event()).unwrap());
}

#[tokio::test]
async fn send_event_waits_for_delivery() {
    let publish_started = Arc::new(Notify::new());
    let complete_delivery = Arc::new(Notify::new());
    let publisher = NotifyControlledPublisher {
        publish_started: Arc::clone(&publish_started),
        complete_delivery: Arc::clone(&complete_delivery),
        failure_message: None,
    };
    let service = MacroEventBrokerService::new(publisher);
    let event = example_macro_event();

    let send_task = tokio::spawn(async move { service.send_event(&event).await });

    publish_started.notified().await;
    assert!(!send_task.is_finished());

    complete_delivery.notify_one();
    send_task
        .await
        .expect("send task should not panic")
        .expect("publish should succeed");
}

#[tokio::test]
async fn send_event_returns_publisher_failure() {
    const FAILURE_MESSAGE: &str = "controlled publisher failure";

    let publish_started = Arc::new(Notify::new());
    let complete_delivery = Arc::new(Notify::new());
    let publisher = NotifyControlledPublisher {
        publish_started: Arc::clone(&publish_started),
        complete_delivery: Arc::clone(&complete_delivery),
        failure_message: Some(FAILURE_MESSAGE),
    };
    let service = MacroEventBrokerService::new(publisher);
    let event = example_macro_event();

    let send_task = tokio::spawn(async move { service.send_event(&event).await });

    publish_started.notified().await;
    assert!(!send_task.is_finished());

    complete_delivery.notify_one();
    let error = send_task
        .await
        .expect("send task should not panic")
        .expect_err("publisher failure should be returned");

    assert!(matches!(
        error,
        EventBrokerError::Publish(message) if message == FAILURE_MESSAGE
    ));
}
