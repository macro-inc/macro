use std::future::pending;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;

use macro_event_topics::{MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use tokio::sync::Notify;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Event, EventBrokerError, MacroEvent, MessageWrapper, TopicEvent};
use crate::domain::ports::{
    EventConsumer, EventPublisher, MacroEventBroker, MessageParts, Spawner,
};
use crate::outbound::spawner::GlobalSpawner;

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
    async fn publish<T: Topic>(&self, key: &str, payload: &[u8]) -> Result<(), EventBrokerError> {
        self.calls.lock().unwrap().push(Published {
            topic: T::TOPIC_STR.to_string(),
            key: key.to_string(),
            payload: payload.to_vec(),
        });
        Ok(())
    }
}

struct RecordingSpawner {
    spawn_count: Arc<AtomicUsize>,
}

impl Spawner for RecordingSpawner {
    fn spawn<F>(&self, future: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.spawn_count.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(future)
    }
}

struct PendingPublisher {
    started: Arc<AtomicBool>,
}

impl EventPublisher for PendingPublisher {
    async fn publish<T: Topic>(&self, _key: &str, _payload: &[u8]) -> Result<(), EventBrokerError> {
        self.started.store(true, Ordering::SeqCst);
        pending().await
    }
}

struct GatedPublisher {
    started: Arc<AtomicBool>,
    release: Arc<Notify>,
}

impl EventPublisher for GatedPublisher {
    async fn publish<T: Topic>(&self, _key: &str, _payload: &[u8]) -> Result<(), EventBrokerError> {
        self.started.store(true, Ordering::SeqCst);
        self.release.notified().await;
        Ok(())
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
    async fn publish<T: Topic>(&self, _key: &str, _payload: &[u8]) -> Result<(), EventBrokerError> {
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
    async fn publish<T: Topic>(&self, _key: &str, _payload: &[u8]) -> Result<(), EventBrokerError> {
        self.attempted.store(true, Ordering::SeqCst);
        Err(EventBrokerError::Publish("test failure".to_string()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExampleCreatedMetadata {
    name: String,
    count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ExampleTopicEvent {
    #[serde(rename = "example.created")]
    Created(ExampleCreatedMetadata),
}

impl TopicEvent for ExampleTopicEvent {
    type Topic = MacroExampleTopic;

    const SCHEMA_VERSION: u8 = 1;
}

pub struct ExampleMacroEvent {
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

crate::declare_topics!(DeclaredMacroEvent: ExampleMacroEvent);

struct TestMessage {
    topic: &'static str,
    key: &'static str,
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some(self.key)
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

struct TestEventConsumer {
    topic: &'static str,
    key: &'static str,
    payload: Vec<u8>,
}

impl EventConsumer<DeclaredMacroEvent> for TestEventConsumer {
    type MessageType<'a> = TestMessage;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, DeclaredMacroEvent>, rootcause::Report> {
        Ok(MessageWrapper::new(TestMessage {
            topic: self.topic,
            key: self.key,
            payload: self.payload.clone(),
        }))
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

#[tokio::test]
async fn consumer_service_receives_and_decodes_typed_event() {
    let event = example_event();
    let consumer = TestEventConsumer {
        topic: MacroExampleTopic::TOPIC_STR,
        key: "msg-123",
        payload: serde_json::to_vec(event.event()).expect("event serializes"),
    };
    let service = MacroEventConsumerService::<DeclaredMacroEvent, _>::new(consumer);

    let message = service.recv().await.expect("message is received");
    let decoded = message.decode_payload().expect("associated topic decodes");
    let DeclaredMacroEvent::ExampleMacroEvent(decoded) = decoded;
    assert_eq!(decoded.key(), "msg-123");
    assert_eq!(decoded.event(), event.event());
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

    const SCHEMA_VERSION: u8 = 1;
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

fn unserializable_event() -> UnserializableMacroEvent {
    UnserializableMacroEvent {
        event: Event::with_event_id(Uuid::from_u128(2), UnserializableTopicEvent),
    }
}

#[tokio::test]
async fn dispatch_serializes_and_routes() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default(), GlobalSpawner);
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
    assert_eq!(call.topic, MacroExampleTopic::TOPIC_STR);
    assert_eq!(call.key, "msg-123");
    assert_eq!(call.payload, expected_payload);
}

#[tokio::test]
async fn dispatch_returns_before_publish_completes() {
    let started = Arc::new(AtomicBool::new(false));
    let service = MacroEventBrokerService::new(
        PendingPublisher {
            started: Arc::clone(&started),
        },
        GlobalSpawner,
    );

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
    let service = MacroEventBrokerService::new(
        HangingPublisher {
            started: Arc::clone(&started),
            dropped: Arc::clone(&dropped),
        },
        GlobalSpawner,
    );

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
    let service = MacroEventBrokerService::new(
        FailingPublisher {
            attempted: Arc::clone(&attempted),
        },
        GlobalSpawner,
    );

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
async fn dispatch_uses_injected_spawner_once() {
    let spawn_count = Arc::new(AtomicUsize::new(0));
    let service = MacroEventBrokerService::new(
        RecordingPublisher::default(),
        RecordingSpawner {
            spawn_count: Arc::clone(&spawn_count),
        },
    );

    service
        .send_event(&example_event())
        .expect("dispatch should succeed")
        .await
        .expect("publish task should complete")
        .expect("publish should succeed");

    assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn task_tracker_waits_for_unfinished_publish() {
    let started = Arc::new(AtomicBool::new(false));
    let release = Arc::new(Notify::new());
    let tracker = TaskTracker::new();
    let service = MacroEventBrokerService::new(
        GatedPublisher {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
        },
        tracker.clone(),
    );

    let handle = service
        .send_event(&example_event())
        .expect("dispatch should succeed");
    tokio::task::yield_now().await;
    assert!(started.load(Ordering::SeqCst));

    tracker.close();
    let wait = tracker.wait();
    tokio::pin!(wait);
    tokio::select! {
        () = &mut wait => panic!("tracker should wait for the unfinished publish"),
        () = tokio::task::yield_now() => {}
    }

    release.notify_one();
    handle
        .await
        .expect("publish task should complete")
        .expect("publish should succeed");
    wait.await;
}

#[tokio::test(start_paused = true)]
async fn task_tracker_drains_hanging_publish_after_timeout() {
    let started = Arc::new(AtomicBool::new(false));
    let dropped = Arc::new(AtomicBool::new(false));
    let tracker = TaskTracker::new();
    let service = MacroEventBrokerService::new(
        HangingPublisher {
            started: Arc::clone(&started),
            dropped: Arc::clone(&dropped),
        },
        tracker.clone(),
    );

    let handle = service
        .send_event(&example_event())
        .expect("dispatch should succeed");
    tokio::task::yield_now().await;
    assert!(started.load(Ordering::SeqCst));

    tracker.close();
    tokio::time::advance(Duration::from_secs(5)).await;
    tokio::task::yield_now().await;
    assert!(!dropped.load(Ordering::SeqCst));

    tokio::time::advance(Duration::from_secs(1)).await;
    tracker.wait().await;
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
async fn dispatch_returns_serialization_failure_without_publishing() {
    let service = MacroEventBrokerService::new(RecordingPublisher::default(), GlobalSpawner);

    let error = service.send_event(&unserializable_event()).unwrap_err();

    assert!(matches!(error, EventBrokerError::Serialization(_)));
    tokio::task::yield_now().await;
    assert!(service.publisher.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn serialization_failure_does_not_invoke_spawner_or_publisher() {
    let spawn_count = Arc::new(AtomicUsize::new(0));
    let service = MacroEventBrokerService::new(
        RecordingPublisher::default(),
        RecordingSpawner {
            spawn_count: Arc::clone(&spawn_count),
        },
    );

    let error = service.send_event(&unserializable_event()).unwrap_err();

    assert!(matches!(error, EventBrokerError::Serialization(_)));
    assert_eq!(spawn_count.load(Ordering::SeqCst), 0);
    assert!(service.publisher.calls.lock().unwrap().is_empty());
}
