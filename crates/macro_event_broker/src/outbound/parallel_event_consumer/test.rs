use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use macro_event_topics::{MacroExampleTopic, Topic};
use rdkafka::Timestamp;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event as TracingEvent, Metadata, Subscriber};
use uuid::Uuid;

use super::*;
use crate::{Event, MacroEvent, TopicEvent};

const TOPIC: &str = MacroExampleTopic::TOPIC_STR;
const KEY: &str = "event-key";

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub(super) enum TestTopicEvent {
    #[serde(rename = "example.test")]
    Test,
}

impl TopicEvent for TestTopicEvent {
    type Topic = MacroExampleTopic;

    const SCHEMA_VERSION: u8 = 1;
}

pub(super) struct TestMacroEvent {
    key: String,
    event: Event<TestTopicEvent>,
}

impl MacroEvent for TestMacroEvent {
    type EventPayload = TestTopicEvent;

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

crate::declare_topics!(TestEvents: TestMacroEvent);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TestError;

struct TimedHandler {
    starts: Arc<Mutex<Vec<Instant>>>,
    duration: Duration,
    succeeds_on: Option<usize>,
}

impl TimedHandler {
    fn new(duration: Duration, succeeds_on: Option<usize>) -> (Self, Arc<Mutex<Vec<Instant>>>) {
        let starts = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                starts: Arc::clone(&starts),
                duration,
                succeeds_on,
            },
            starts,
        )
    }
}

impl Handler<TestEvents> for TimedHandler {
    type Error = TestError;

    fn handle(&self, event: TestEvents) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let TestEvents::TestMacroEvent(_event) = event;
        let starts = Arc::clone(&self.starts);
        let duration = self.duration;
        let succeeds_on = self.succeeds_on;

        async move {
            let attempt = {
                let mut starts = starts.lock().unwrap();
                starts.push(Instant::now());
                starts.len()
            };
            tokio::time::sleep(duration).await;
            if succeeds_on == Some(attempt) {
                Ok(())
            } else {
                Err(TestError)
            }
        }
    }
}

struct PanicHandler;

impl Handler<TestEvents> for PanicHandler {
    type Error = TestError;

    async fn handle(&self, _event: TestEvents) -> Result<(), Self::Error> {
        panic!("decode failures must not invoke the handler")
    }
}

#[derive(Clone)]
struct RecordingPolicy {
    decisions: Arc<Mutex<Vec<(usize, &'static str)>>>,
    final_decision: DeliveryDecision,
}

impl RecordingPolicy {
    fn new(final_decision: DeliveryDecision) -> Self {
        Self {
            decisions: Arc::new(Mutex::new(Vec::new())),
            final_decision,
        }
    }
}

impl DeliveryPolicy<TestError> for RecordingPolicy {
    fn per_attempt_timeout(&self) -> Duration {
        Duration::from_secs(300)
    }

    fn decide(&self, attempt: usize, error: &DeliveryError<TestError>) -> DeliveryDecision {
        let error_kind = match error {
            DeliveryError::Decode(_) => "decode",
            DeliveryError::Handler(_) => "handler",
            DeliveryError::Timeout { .. } => "timeout",
        };
        self.decisions.lock().unwrap().push((attempt, error_kind));

        if attempt == 1 && self.final_decision == DeliveryDecision::Drop {
            DeliveryDecision::Retry(Duration::from_secs(1))
        } else {
            self.final_decision
        }
    }
}

fn message(payload: Vec<u8>) -> OwnedMessage {
    OwnedMessage::new(
        Some(payload),
        Some(KEY.as_bytes().to_vec()),
        TOPIC.to_owned(),
        Timestamp::NotAvailable,
        3,
        42,
        None,
    )
}

fn valid_message() -> OwnedMessage {
    let event = Event::with_event_id(Uuid::from_u128(1), TestTopicEvent::Test);
    message(serde_json::to_vec(&event).unwrap())
}

fn elapsed_starts(starts: &Arc<Mutex<Vec<Instant>>>, initial: Instant) -> Vec<Duration> {
    starts
        .lock()
        .unwrap()
        .iter()
        .map(|start| start.duration_since(initial))
        .collect()
}

#[test]
fn uniform_bounded_retry_defaults_and_handler_error_decisions_are_exact() {
    let policy = UniformBoundedRetry::default();
    assert_eq!(policy.max_attempts, 5);
    assert_eq!(policy.base_backoff, Duration::from_secs(1));
    assert_eq!(policy.per_attempt_timeout, Duration::from_secs(300));

    let error = DeliveryError::<TestError>::Handler(TestError);
    let decisions = (1..=5)
        .map(|attempt| policy.decide(attempt, &error))
        .collect::<Vec<_>>();
    assert_eq!(
        decisions,
        vec![
            DeliveryDecision::Retry(Duration::from_secs(1)),
            DeliveryDecision::Retry(Duration::from_secs(2)),
            DeliveryDecision::Retry(Duration::from_secs(4)),
            DeliveryDecision::Retry(Duration::from_secs(8)),
            DeliveryDecision::Drop,
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn default_policy_retries_handler_errors_with_bounded_doubling_backoff() {
    let initial = Instant::now();
    let (handler, starts) = TimedHandler::new(Duration::ZERO, None);

    let result = process_message::<TestEvents, _, _>(
        valid_message(),
        Arc::new(handler),
        Arc::new(UniformBoundedRetry::default()),
    )
    .await;

    assert!(result.is_ok(), "exhaustion is commit-safe");
    assert_eq!(
        elapsed_starts(&starts, initial),
        [0, 1, 3, 7, 15].map(Duration::from_secs)
    );
}

#[tokio::test(start_paused = true)]
async fn four_nearly_timed_out_attempts_do_not_prevent_the_fifth_attempt() {
    let initial = Instant::now();
    let (handler, starts) = TimedHandler::new(Duration::from_secs(299), Some(5));

    let result = process_message::<TestEvents, _, _>(
        valid_message(),
        Arc::new(handler),
        Arc::new(UniformBoundedRetry::default()),
    )
    .await;

    assert!(result.is_ok());
    assert_eq!(
        elapsed_starts(&starts, initial),
        [0, 300, 601, 904, 1211].map(Duration::from_secs)
    );
}

#[tokio::test(start_paused = true)]
async fn every_retry_receives_a_fresh_per_attempt_timeout() {
    let initial = Instant::now();
    let (handler, starts) = TimedHandler::new(Duration::from_secs(301), None);
    let policy = UniformBoundedRetry {
        max_attempts: 2,
        base_backoff: Duration::from_secs(1),
        per_attempt_timeout: Duration::from_secs(300),
    };

    let result =
        process_message::<TestEvents, _, _>(valid_message(), Arc::new(handler), Arc::new(policy))
            .await;

    assert!(result.is_ok());
    assert_eq!(
        elapsed_starts(&starts, initial),
        [0, 301].map(Duration::from_secs)
    );
}

#[tokio::test(start_paused = true)]
async fn timeout_does_not_start_before_the_processing_future_is_polled() {
    let (handler, starts) = TimedHandler::new(Duration::from_secs(299), Some(1));
    let future = process_message::<TestEvents, _, _>(
        valid_message(),
        Arc::new(handler),
        Arc::new(UniformBoundedRetry::default()),
    );

    tokio::time::advance(Duration::from_secs(1_000)).await;
    let actual_start = Instant::now();
    let result = future.await;

    assert!(result.is_ok());
    assert_eq!(starts.lock().unwrap().as_slice(), &[actual_start]);
}

#[tokio::test(start_paused = true)]
async fn default_policy_drops_decode_failures_on_the_first_attempt() {
    let subscriber = CaptureSubscriber::default();
    let events = Arc::clone(&subscriber.events);
    let malformed_event = message(br#"{"event_type":"example.test"}"#.to_vec());

    let result = {
        let _guard = tracing::subscriber::set_default(subscriber);
        process_message::<TestEvents, _, _>(
            malformed_event,
            Arc::new(PanicHandler),
            Arc::new(UniformBoundedRetry::default()),
        )
        .await
    };

    assert!(result.is_ok(), "a decode failure is dropped commit-safe");
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].fields.get("attempts").unwrap(), "1");
    assert!(events[0].fields.get("error").unwrap().contains("Decode"));
}

#[tokio::test(start_paused = true)]
async fn custom_policy_can_retry_decode_failures() {
    let policy = RecordingPolicy::new(DeliveryDecision::Drop);
    let decisions = Arc::clone(&policy.decisions);
    let malformed_event = message(br#"{"event_type":"example.test"}"#.to_vec());

    let result = process_message::<TestEvents, _, _>(
        malformed_event,
        Arc::new(PanicHandler),
        Arc::new(policy),
    )
    .await;

    assert!(result.is_ok());
    assert_eq!(
        decisions.lock().unwrap().as_slice(),
        &[(1, "decode"), (2, "decode")]
    );
}

#[test]
fn malformed_payload_event_type_is_best_effort_with_unknown_fallback() {
    assert_eq!(
        extract_event_type(Some(br#"{"event_type":"example.test"}"#)),
        "example.test"
    );
    assert_eq!(extract_event_type(Some(b"not-json")), "unknown");
    assert_eq!(extract_event_type(Some(br#"{"event_type":4}"#)), "unknown");
    assert_eq!(extract_event_type(None), "unknown");
}

#[tokio::test(start_paused = true)]
async fn drop_is_commit_safe_and_processing_can_continue() {
    let (failing_handler, _) = TimedHandler::new(Duration::ZERO, None);
    let drop_policy = UniformBoundedRetry {
        max_attempts: 1,
        ..UniformBoundedRetry::default()
    };
    let dropped = process_message::<TestEvents, _, _>(
        valid_message(),
        Arc::new(failing_handler),
        Arc::new(drop_policy),
    )
    .await;

    let (successful_handler, starts) = TimedHandler::new(Duration::ZERO, Some(1));
    let processed = process_message::<TestEvents, _, _>(
        valid_message(),
        Arc::new(successful_handler),
        Arc::new(UniformBoundedRetry::default()),
    )
    .await;

    assert!(dropped.is_ok(), "a policy drop must be commit-safe");
    assert!(processed.is_ok(), "later processing must continue");
    assert_eq!(starts.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn fatal_policy_returns_non_commit_safe_failure() {
    let (handler, starts) = TimedHandler::new(Duration::ZERO, None);
    let policy = RecordingPolicy::new(DeliveryDecision::Fatal);

    let result =
        process_message::<TestEvents, _, _>(valid_message(), Arc::new(handler), Arc::new(policy))
            .await;

    assert!(matches!(result, Err(DeliveryError::Handler(TestError))));
    assert_eq!(starts.lock().unwrap().len(), 1);
}

#[test]
fn declared_collection_supplies_the_exact_subscription_topics() {
    assert_eq!(TestEvents::topics(), &[MacroExampleTopic::TOPIC_STR]);

    fn assert_entrypoint<G, M, H, P>()
    where
        G: GroupName,
        M: MacroEventCollection + Send + 'static,
        H: Handler<M>,
        P: DeliveryPolicy<H::Error>,
    {
        let _ = run_parallel_event_consumer::<G, M, H, P>;
    }

    struct TestGroup;
    impl GroupName for TestGroup {
        const GROUP_NAME: &'static str = "parallel-event-consumer-test";
    }

    assert_entrypoint::<TestGroup, TestEvents, PanicHandler, RecordingPolicy>();
}

#[derive(Clone, Debug, Default)]
struct CaptureSubscriber {
    events: Arc<Mutex<Vec<CapturedEvent>>>,
    next_span_id: Arc<AtomicU64>,
}

#[derive(Clone, Debug, Default)]
struct CapturedEvent {
    fields: BTreeMap<String, String>,
}

impl Subscriber for CaptureSubscriber {
    fn enabled(&self, _metadata: &Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _span: &Attributes<'_>) -> Id {
        let id = self.next_span_id.fetch_add(1, Ordering::Relaxed) + 1;
        Id::from_u64(id)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, event: &TracingEvent<'_>) {
        let mut captured = CapturedEvent::default();
        event.record(&mut FieldVisitor(&mut captured.fields));
        self.events.lock().unwrap().push(captured);
    }

    fn enter(&self, _span: &Id) {}

    fn exit(&self, _span: &Id) {}
}

struct FieldVisitor<'a>(&'a mut BTreeMap<String, String>);

impl Visit for FieldVisitor<'_> {
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0.insert(field.name().to_owned(), value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name().to_owned(), value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_owned(), value.to_owned());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0.insert(field.name().to_owned(), format!("{value:?}"));
    }
}

#[test]
fn drop_log_has_stable_message_and_required_fields_exactly_once() {
    let subscriber = CaptureSubscriber::default();
    let events = Arc::clone(&subscriber.events);
    let metadata = DeliveryMetadata {
        event_type: "example.test".to_owned(),
        key: KEY.to_owned(),
        topic: TOPIC.to_owned(),
        partition: 3,
        offset: 42,
    };
    let error = DeliveryError::<TestError>::Handler(TestError);

    tracing::subscriber::with_default(subscriber, || {
        log_dropped_event(&metadata, 1, &error);
    });

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    let fields = &events[0].fields;
    assert_eq!(fields.get("message").unwrap(), DROP_LOG_MESSAGE);
    assert_eq!(fields.get("attempts").unwrap(), "1");
    assert_eq!(fields.get("event_type").unwrap(), "example.test");
    assert_eq!(fields.get("key").unwrap(), KEY);
    assert_eq!(fields.get("topic").unwrap(), TOPIC);
    assert_eq!(fields.get("partition").unwrap(), "3");
    assert_eq!(fields.get("offset").unwrap(), "42");
    assert!(fields.get("error").unwrap().contains("Handler"));
}
