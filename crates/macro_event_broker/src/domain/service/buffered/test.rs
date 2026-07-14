use std::collections::HashSet;
use std::io::{self, Write};
use std::sync::{Arc, Mutex, Once, OnceLock};
use std::time::Duration;

use macro_event_topics::{MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize, Serializer};
use tokio::sync::Notify;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Event, TopicEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
struct Published {
    topic: &'static str,
    key: String,
    payload: Vec<u8>,
}

struct RecordingPublisher {
    calls: Arc<Mutex<Vec<Published>>>,
    failing_keys: HashSet<String>,
}

impl RecordingPublisher {
    fn new(calls: Arc<Mutex<Vec<Published>>>) -> Self {
        Self {
            calls,
            failing_keys: HashSet::new(),
        }
    }

    fn failing(calls: Arc<Mutex<Vec<Published>>>, keys: &[&str]) -> Self {
        Self {
            calls,
            failing_keys: keys.iter().map(|key| (*key).to_owned()).collect(),
        }
    }
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
            key: key.to_owned(),
            payload: payload.to_vec(),
        });

        if self.failing_keys.contains(key) {
            return Err(EventBrokerError::Publish("controlled failure".to_owned()));
        }

        Ok(())
    }
}

struct BlockingPublisher {
    started: Arc<Notify>,
    release: Arc<Notify>,
    dropped: Option<Arc<Notify>>,
}

impl EventPublisher for BlockingPublisher {
    async fn publish(
        &self,
        _topic: &'static str,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        let _drop_notification = self.dropped.clone().map(NotifyOnDrop);
        self.started.notify_one();
        self.release.notified().await;
        Ok(())
    }
}

struct NotifyOnDrop(Arc<Notify>);

impl Drop for NotifyOnDrop {
    fn drop(&mut self) {
        self.0.notify_one();
    }
}

struct PanickingPublisher {
    started: Arc<Notify>,
}

impl EventPublisher for PanickingPublisher {
    async fn publish(
        &self,
        _topic: &'static str,
        _key: &str,
        _payload: &[u8],
    ) -> Result<(), EventBrokerError> {
        self.started.notify_one();
        panic!("controlled publisher panic");
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ExampleCreatedMetadata {
    name: String,
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

struct TestMacroEvent<E: TopicEvent> {
    key: String,
    event: Event<E>,
}

impl<E: TopicEvent> MacroEvent for TestMacroEvent<E> {
    type EventPayload = E;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

fn test_event(
    key: impl Into<String>,
    name: impl Into<String>,
) -> TestMacroEvent<ExampleTopicEvent> {
    TestMacroEvent {
        key: key.into(),
        event: Event::with_event_id(
            Uuid::from_u128(1),
            ExampleTopicEvent::Created(ExampleCreatedMetadata { name: name.into() }),
        ),
    }
}

fn config(queue_capacity: usize) -> BufferedBrokerConfig {
    BufferedBrokerConfig {
        queue_capacity,
        shutdown_timeout: Duration::from_secs(5),
    }
}

#[test]
fn config_has_bounded_defaults() {
    assert_eq!(
        BufferedBrokerConfig::default(),
        BufferedBrokerConfig {
            queue_capacity: 1_024,
            shutdown_timeout: Duration::from_secs(5),
        }
    );
}

#[tokio::test]
#[should_panic(expected = "buffered broker queue capacity must be greater than zero")]
async fn zero_capacity_is_rejected_before_channel_creation() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let _ = BufferedMacroEventBroker::start(RecordingPublisher::new(calls), config(0));
}

#[tokio::test]
async fn accepted_event_is_serialized_and_routed() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) =
        BufferedMacroEventBroker::start(RecordingPublisher::new(Arc::clone(&calls)), config(4));
    let event = test_event("event-key", "serialized-name");
    let expected_payload = serde_json::to_vec(event.event()).unwrap();

    broker.send_event(&event).await.unwrap();
    let report = runtime.shutdown().await;

    assert_eq!(report.delivered, 1);
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Published {
            topic: MacroExampleTopic.as_str(),
            key: "event-key".to_owned(),
            payload: expected_payload,
        }]
    );
}

#[tokio::test]
async fn enqueue_does_not_wait_for_publisher_delivery() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
            dropped: None,
        },
        config(1),
    );
    let event = test_event("key", "value");

    let send_task = tokio::spawn(async move { broker.send_event(&event).await });
    started.notified().await;

    assert!(send_task.is_finished());
    send_task.await.unwrap().unwrap();
    release.notify_one();
    assert_eq!(runtime.shutdown().await.delivered, 1);
}

#[tokio::test]
async fn queue_rejects_newest_event_when_full() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
            dropped: None,
        },
        config(2),
    );

    broker.send_event(&test_event("one", "one")).await.unwrap();
    started.notified().await;
    broker.send_event(&test_event("two", "two")).await.unwrap();
    broker
        .send_event(&test_event("three", "three"))
        .await
        .unwrap();

    let error = broker
        .send_event(&test_event("four", "four"))
        .await
        .unwrap_err();
    assert!(matches!(error, EventBrokerError::QueueFull { capacity: 2 }));
    assert_eq!(broker.stats().full, 1);

    release.notify_one();
    started.notified().await;
    release.notify_one();
    started.notified().await;
    release.notify_one();
    assert_eq!(runtime.shutdown().await.delivered, 3);
}

#[tokio::test]
async fn worker_dispatches_same_key_events_in_fifo_order() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) =
        BufferedMacroEventBroker::start(RecordingPublisher::new(Arc::clone(&calls)), config(4));
    let events = [
        test_event("shared-key", "first"),
        test_event("shared-key", "second"),
        test_event("shared-key", "third"),
    ];
    let expected_payloads: Vec<_> = events
        .iter()
        .map(|event| serde_json::to_vec(event.event()).unwrap())
        .collect();

    for event in &events {
        broker.send_event(event).await.unwrap();
    }
    runtime.shutdown().await;

    let actual_payloads: Vec<_> = calls
        .lock()
        .unwrap()
        .iter()
        .map(|call| call.payload.clone())
        .collect();
    assert_eq!(actual_payloads, expected_payloads);
}

#[tokio::test]
async fn cloned_brokers_share_one_queue_and_worker() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) =
        BufferedMacroEventBroker::start(RecordingPublisher::new(Arc::clone(&calls)), config(4));
    let broker_clone = broker.clone();

    broker
        .send_event(&test_event("original", "one"))
        .await
        .unwrap();
    broker_clone
        .send_event(&test_event("clone", "two"))
        .await
        .unwrap();
    runtime.shutdown().await;

    let keys: Vec<_> = calls
        .lock()
        .unwrap()
        .iter()
        .map(|call| call.key.clone())
        .collect();
    assert_eq!(keys, ["original", "clone"]);
}

#[tokio::test]
async fn publisher_failure_does_not_stop_later_delivery() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) = BufferedMacroEventBroker::start(
        RecordingPublisher::failing(Arc::clone(&calls), &["fails"]),
        config(4),
    );

    broker
        .send_event(&test_event("fails", "first"))
        .await
        .unwrap();
    broker
        .send_event(&test_event("succeeds", "second"))
        .await
        .unwrap();
    let report = runtime.shutdown().await;

    assert_eq!(report.failed, 1);
    assert_eq!(report.delivered, 1);
    let keys: Vec<_> = calls
        .lock()
        .unwrap()
        .iter()
        .map(|call| call.key.clone())
        .collect();
    assert_eq!(keys, ["fails", "succeeds"]);
}

#[tokio::test]
async fn send_after_shutdown_starts_returns_queue_closed() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
            dropped: None,
        },
        config(1),
    );

    broker
        .send_event(&test_event("accepted", "accepted"))
        .await
        .unwrap();
    started.notified().await;
    let shutdown_task = tokio::spawn(runtime.shutdown());
    tokio::task::yield_now().await;
    assert!(broker.state.is_closed());

    let error = broker
        .send_event(&test_event("rejected", "rejected"))
        .await
        .unwrap_err();
    assert!(matches!(error, EventBrokerError::QueueClosed));
    assert_eq!(broker.stats().closed, 1);

    release.notify_one();
    assert_eq!(shutdown_task.await.unwrap().delivered, 1);
}

#[tokio::test]
async fn graceful_shutdown_drains_all_accepted_events() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release: Arc::clone(&release),
            dropped: None,
        },
        config(2),
    );

    broker.send_event(&test_event("one", "one")).await.unwrap();
    broker.send_event(&test_event("two", "two")).await.unwrap();
    started.notified().await;
    let shutdown_task = tokio::spawn(runtime.shutdown());
    tokio::task::yield_now().await;
    assert!(!shutdown_task.is_finished());

    release.notify_one();
    started.notified().await;
    assert!(!shutdown_task.is_finished());
    release.notify_one();

    assert_eq!(
        shutdown_task.await.unwrap(),
        BufferedBrokerShutdownReport {
            delivered: 2,
            failed: 0,
            abandoned: 0,
            timed_out: false,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_timeout_aborts_worker_and_reports_abandoned_events() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let shutdown_timeout = Duration::from_secs(3);
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release,
            dropped: None,
        },
        BufferedBrokerConfig {
            queue_capacity: 2,
            shutdown_timeout,
        },
    );

    broker.send_event(&test_event("one", "one")).await.unwrap();
    broker.send_event(&test_event("two", "two")).await.unwrap();
    started.notified().await;
    let shutdown_task = tokio::spawn(runtime.shutdown());
    tokio::task::yield_now().await;

    tokio::time::advance(shutdown_timeout + Duration::from_millis(1)).await;
    let report = shutdown_task.await.unwrap();

    assert!(report.timed_out);
    assert_eq!(report.abandoned, 2);
    assert_eq!(broker.stats().abandoned, 2);
}

#[derive(Debug, Deserialize)]
struct InvalidTopicEvent;

impl Serialize for InvalidTopicEvent {
    fn serialize<S: Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom(
            "controlled serialization failure",
        ))
    }
}

impl TopicEvent for InvalidTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

#[tokio::test]
async fn serialization_failure_does_not_consume_queue_capacity() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) =
        BufferedMacroEventBroker::start(RecordingPublisher::new(Arc::clone(&calls)), config(1));
    let invalid_event = TestMacroEvent {
        key: "invalid".to_owned(),
        event: Event::with_event_id(Uuid::from_u128(1), InvalidTopicEvent),
    };

    let error = broker.send_event(&invalid_event).await.unwrap_err();
    assert!(matches!(error, EventBrokerError::Serialization(_)));
    assert_eq!(broker.stats().accepted, 0);

    broker
        .send_event(&test_event("valid", "valid"))
        .await
        .unwrap();
    assert_eq!(runtime.shutdown().await.delivered, 1);
}

#[tokio::test]
async fn statistics_snapshot_reports_each_delivery_outcome() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) =
        BufferedMacroEventBroker::start(RecordingPublisher::failing(calls, &["fails"]), config(2));

    broker
        .send_event(&test_event("succeeds", "one"))
        .await
        .unwrap();
    broker
        .send_event(&test_event("fails", "two"))
        .await
        .unwrap();
    runtime.shutdown().await;

    assert_eq!(
        broker.stats(),
        BufferedBrokerStats {
            accepted: 2,
            full: 0,
            closed: 0,
            delivered: 1,
            failed: 1,
            abandoned: 0,
        }
    );
}

#[tokio::test]
async fn dropping_runtime_closes_intake_and_aborts_worker() {
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let dropped = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        BlockingPublisher {
            started: Arc::clone(&started),
            release,
            dropped: Some(Arc::clone(&dropped)),
        },
        config(1),
    );

    broker
        .send_event(&test_event("accepted", "accepted"))
        .await
        .unwrap();
    started.notified().await;
    drop(runtime);
    dropped.notified().await;

    assert_eq!(broker.stats().abandoned, 1);
    assert!(matches!(
        broker.send_event(&test_event("closed", "closed")).await,
        Err(EventBrokerError::QueueClosed)
    ));
}

#[tokio::test]
async fn unexpected_worker_termination_closes_intake() {
    let started = Arc::new(Notify::new());
    let (broker, runtime) = BufferedMacroEventBroker::start(
        PanickingPublisher {
            started: Arc::clone(&started),
        },
        config(1),
    );

    broker
        .send_event(&test_event("panics", "panics"))
        .await
        .unwrap();
    started.notified().await;
    tokio::task::yield_now().await;

    assert!(matches!(
        broker.send_event(&test_event("closed", "closed")).await,
        Err(EventBrokerError::QueueClosed)
    ));
    let report = runtime.shutdown().await;
    assert_eq!(report.abandoned, 1);
}

#[derive(Clone)]
struct CapturedLogWriter {
    buffer: Arc<Mutex<Vec<u8>>>,
}

struct CapturedLog {
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl Write for CapturedLog {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.buffer.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLogWriter {
    type Writer = CapturedLog;

    fn make_writer(&'a self) -> Self::Writer {
        CapturedLog {
            buffer: Arc::clone(&self.buffer),
        }
    }
}

fn captured_logs() -> Arc<Mutex<Vec<u8>>> {
    static LOGS: OnceLock<Arc<Mutex<Vec<u8>>>> = OnceLock::new();
    static INSTALL: Once = Once::new();

    let logs = Arc::clone(LOGS.get_or_init(|| Arc::new(Mutex::new(Vec::new()))));
    INSTALL.call_once(|| {
        tracing_subscriber::fmt()
            .with_ansi(false)
            .without_time()
            .with_max_level(tracing::Level::TRACE)
            .with_writer(CapturedLogWriter {
                buffer: Arc::clone(&logs),
            })
            .try_init()
            .expect("test tracing subscriber should install");
    });
    logs
}

#[tokio::test]
async fn error_logs_never_include_serialized_payload() {
    const DISTINCTIVE_PAYLOAD: &str = "payload-secret-7f6c2ca4";

    let logs = captured_logs();
    logs.lock().unwrap().clear();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (broker, runtime) = BufferedMacroEventBroker::start(
        RecordingPublisher::failing(calls, &["failure-key"]),
        config(1),
    );

    broker
        .send_event(&test_event("failure-key", DISTINCTIVE_PAYLOAD))
        .await
        .unwrap();
    let report = runtime.shutdown().await;
    assert_eq!(report.failed, 1);

    let output = String::from_utf8(logs.lock().unwrap().clone()).unwrap();
    assert!(output.contains("buffered macro event delivery failed"));
    assert!(!output.contains(DISTINCTIVE_PAYLOAD), "logs: {output}");
}
