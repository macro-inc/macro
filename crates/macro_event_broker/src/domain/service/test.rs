use std::future::pending;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

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

struct PendingPublisher {
    started: Arc<AtomicBool>,
}

impl EventPublisher for PendingPublisher {
    async fn publish<T: Topic>(
        &self,
        _topic: T,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.started.store(true, Ordering::SeqCst);
        pending().await
    }
}

struct PublishDropGuard {
    dropped: Arc<AtomicBool>,
}

impl Drop for PublishDropGuard {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::SeqCst);
    }
}

struct HangingPublisher {
    started: Arc<AtomicBool>,
    dropped: Arc<AtomicBool>,
}

impl EventPublisher for HangingPublisher {
    async fn publish<T: Topic>(
        &self,
        _topic: T,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.started.store(true, Ordering::SeqCst);
        let _drop_guard = PublishDropGuard {
            dropped: Arc::clone(&self.dropped),
        };
        pending().await
    }
}

struct FailingPublisher {
    attempted: Arc<AtomicBool>,
}

impl EventPublisher for FailingPublisher {
    async fn publish<T: Topic>(
        &self,
        _topic: T,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.attempted.store(true, Ordering::SeqCst);
        Err(EventBrokerError::Publish("test failure".to_string()))
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

fn example_event() -> ExampleMacroEvent {
    ExampleMacroEvent::with_event(
        "msg-123",
        Event::with_event_id(
            Uuid::from_u128(1),
            ExampleTopicEvent::Created(ExampleCreatedMetadata {
                name: "hello".to_string(),
                count: 7,
            }),
        ),
    )
}

#[derive(Debug, Deserialize)]
struct UnserializableTopicEvent;

impl Serialize for UnserializableTopicEvent {
    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        Err(serde::ser::Error::custom("test serialization failure"))
    }
}

impl TopicEvent for UnserializableTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

struct UnserializableMacroEvent {
    event: Event<UnserializableTopicEvent>,
}

impl MacroEvent for UnserializableMacroEvent {
    type EventPayload = UnserializableTopicEvent;

    fn key(&self) -> &str {
        "unserializable"
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(_key: String, event: Event<Self::EventPayload>) -> Self {
        Self { event }
    }
}

#[tokio::test]
async fn dispatch_serializes_and_routes() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default());
    let event = example_event();
    let expected_payload = serde_json::to_vec(event.event()).unwrap();

    service
        .send_event(&event)
        .expect("dispatch should succeed")
        .await
        .expect("publish task should complete")
        .expect("publish should succeed");

    let calls = service.publisher.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.topic, MacroExampleTopic.as_str());
    assert_eq!(call.key, "msg-123");
    assert_eq!(call.payload, expected_payload);
}

#[tokio::test]
async fn dispatch_returns_before_publish_completes() {
    let started = Arc::new(AtomicBool::new(false));
    let service = MacroEventBrokerService::new(PendingPublisher {
        started: Arc::clone(&started),
    });

    let handle = service
        .send_event(&example_event())
        .expect("dispatch should succeed");

    assert!(!started.load(Ordering::SeqCst));
    assert!(!handle.is_finished());
    tokio::task::yield_now().await;
    assert!(started.load(Ordering::SeqCst));
    handle.abort();
}

#[tokio::test(start_paused = true)]
async fn dispatch_cancels_publish_at_six_second_timeout() {
    let started = Arc::new(AtomicBool::new(false));
    let dropped = Arc::new(AtomicBool::new(false));
    let service = MacroEventBrokerService::new(HangingPublisher {
        started: Arc::clone(&started),
        dropped: Arc::clone(&dropped),
    });

    let handle = service
        .send_event(&example_event())
        .expect("dispatch should succeed");
    tokio::task::yield_now().await;
    assert!(started.load(Ordering::SeqCst));

    tokio::time::advance(Duration::from_secs(5)).await;
    tokio::task::yield_now().await;
    assert!(!dropped.load(Ordering::SeqCst));

    tokio::time::advance(Duration::from_secs(1)).await;
    let error = handle
        .await
        .expect("publish task should complete")
        .unwrap_err();
    assert!(matches!(
        error,
        EventBrokerError::PublishTimeout { timeout } if timeout == PUBLISH_TIMEOUT
    ));
    assert!(dropped.load(Ordering::SeqCst));
}

#[tokio::test]
async fn dispatch_returns_publisher_failure_from_task() {
    let attempted = Arc::new(AtomicBool::new(false));
    let service = MacroEventBrokerService::new(FailingPublisher {
        attempted: Arc::clone(&attempted),
    });

    let error = service
        .send_event(&example_event())
        .expect("dispatch should succeed before publishing")
        .await
        .expect("publish task should complete")
        .unwrap_err();

    assert!(matches!(error, EventBrokerError::Publish(message) if message == "test failure"));
    assert!(attempted.load(Ordering::SeqCst));
}

#[tokio::test]
async fn dispatch_returns_serialization_failure_without_publishing() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default());
    let event = UnserializableMacroEvent {
        event: Event::with_event_id(Uuid::from_u128(2), UnserializableTopicEvent),
    };

    let error = service.send_event(&event).unwrap_err();
    assert!(matches!(error, EventBrokerError::Serialization(_)));
    tokio::task::yield_now().await;
    assert!(service.publisher.calls.lock().unwrap().is_empty());
}
