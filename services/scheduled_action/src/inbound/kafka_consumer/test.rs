use super::*;
use crate::domain::event_trigger::EventRejection;
use macro_event_broker::Event;
use macro_uuid::Uuid;
use rdkafka::message::{OwnedMessage, Timestamp};
use serde_json::{Value, json};
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

const EVENT_ID: &str = "01900000-0000-7000-8000-000000000003";
const ENTITY_ID: &str = "01900000-0000-7000-8000-000000000001";

#[derive(Default)]
struct State {
    messages: VecDeque<OwnedMessage>,
    received: Vec<i64>,
    operations: Vec<&'static str>,
    committed: Vec<i64>,
    commit_attempts: Vec<i64>,
    fail_commit: bool,
    calls: Vec<Uuid>,
    admitted: HashSet<(u8, Uuid)>,
    inserted: Vec<u64>,
    steps: VecDeque<Step>,
}

enum Step {
    Admit,
    PartialFailure,
    Reject(EventRejection),
    ShutdownDuringAdmission,
    ShutdownBeforeBackoff,
}

#[derive(Clone, Default)]
struct FakeConsumer {
    state: Arc<Mutex<State>>,
    shutdown: CancellationToken,
}

impl EventConsumer<DeclaredMacroEvent> for FakeConsumer {
    type MessageType<'a> = OwnedMessage;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, DeclaredMacroEvent>, Report> {
        let mut state = self.state.lock().unwrap();
        let message = state.messages.pop_front().expect("unexpected receive");
        state.received.push(message.offset());
        Ok(MessageWrapper::new(message))
    }
}

impl CommittingConsumer for FakeConsumer {
    fn commit(&self, message: &OwnedMessage) -> Result<(), Report> {
        let mut state = self.state.lock().unwrap();
        state.operations.push("commit");
        state.commit_attempts.push(message.offset());
        if state.fail_commit {
            return Err(rootcause::report!("fake commit failure"));
        }
        state.committed.push(message.offset());
        if state.messages.is_empty() {
            self.shutdown.cancel();
        }
        Ok(())
    }
}

// This fake models durable admission's idempotency contract, not matching or
// execution. No repositories, agent runners, or model clients are constructed.
#[derive(Clone)]
struct FakeIngestion(FakeConsumer);

impl EventIngestion for FakeIngestion {
    async fn ingest(&self, event: &IncomingEvent) -> Result<EventIngestionResult, Report> {
        let step = {
            let mut state = self.0.state.lock().unwrap();
            state.operations.push("ingest");
            state.calls.push(event.event_id);
            let step = state.steps.pop_front().unwrap_or(Step::Admit);
            match step {
                Step::Admit => {
                    let mut inserted = 0;
                    for action_id in [1, 2] {
                        inserted += u64::from(state.admitted.insert((action_id, event.event_id)));
                    }
                    state.inserted.push(inserted);
                    return Ok(EventIngestionResult::Admitted { inserted });
                }
                Step::Reject(reason) => return Ok(EventIngestionResult::Rejected(reason)),
                _ => {
                    state.admitted.insert((1, event.event_id));
                    step
                }
            }
        };
        match step {
            Step::ShutdownDuringAdmission => {
                self.0.shutdown.cancel();
                std::future::pending().await
            }
            Step::ShutdownBeforeBackoff => {
                self.0.shutdown.cancel();
                Err(rootcause::report!("fake transient failure"))
            }
            _ => Err(rootcause::report!("fake failure after partial fan-out")),
        }
    }
}

fn envelope(name: &str) -> Value {
    json!({
        "event_id": EVENT_ID,
        "schema_version": 1,
        "event_type": name,
        "metadata": {
            "document_id": ENTITY_ID, "owner": "macro|human@example.com",
            "actor": "macro|human@example.com", "document_name": "Private title",
            "file_type": "md", "channel_id": ENTITY_ID, "channel_type": "public",
            "participant_user_ids": ["macro|human@example.com"]
        }
    })
}

fn message(
    topic: &str,
    payload: Option<Vec<u8>>,
    key: Option<Vec<u8>>,
    offset: i64,
) -> OwnedMessage {
    OwnedMessage::new(
        payload,
        key,
        topic.to_owned(),
        Timestamp::NotAvailable,
        0,
        offset,
        None,
    )
}

fn document(offset: i64) -> OwnedMessage {
    message(
        "macro.documents",
        Some(serde_json::to_vec(&envelope("document.created")).unwrap()),
        Some(ENTITY_ID.as_bytes().to_vec()),
        offset,
    )
}

fn fixture(messages: Vec<OwnedMessage>, steps: Vec<Step>) -> FakeConsumer {
    FakeConsumer {
        state: Arc::new(Mutex::new(State {
            messages: messages.into(),
            steps: steps.into(),
            ..State::default()
        })),
        shutdown: CancellationToken::new(),
    }
}

async fn run(consumer: &FakeConsumer) -> Result<(), Report> {
    tokio::time::timeout(
        Duration::from_secs(1),
        consume(
            consumer.clone(),
            FakeIngestion(consumer.clone()),
            consumer.shutdown.cancelled(),
            Duration::ZERO,
        ),
    )
    .await
    .expect("consumer did not terminate")
}

#[test]
fn subscriptions_are_exact_and_group_is_dedicated() {
    assert_eq!(
        DeclaredMacroEvent::topics(),
        &["macro.documents", "macro.channels"]
    );
    assert_eq!(
        ScheduledActionEventIngestionGroup::GROUP_NAME,
        "scheduled-action-event-ingestion"
    );
}

#[tokio::test]
async fn admits_both_topics_before_committing() {
    let channel = message(
        "macro.channels",
        Some(serde_json::to_vec(&envelope("channel.created")).unwrap()),
        Some(ENTITY_ID.as_bytes().to_vec()),
        11,
    );
    // Confirm transport conversion preserves identity, schema and typed payload.
    let decoded = DeclaredMacroEvent::decode(&channel).unwrap();
    let incoming = incoming_event(decoded);
    assert_eq!(incoming.event_id.to_string(), EVENT_ID);
    assert_eq!(incoming.schema_version, 1);
    assert!(matches!(incoming.payload, EventPayload::Channel(_)));
    let consumer = fixture(vec![document(10), channel], vec![]);
    run(&consumer).await.unwrap();
    let state = consumer.state.lock().unwrap();
    assert_eq!(state.calls.len(), 2);
    assert_eq!(state.committed, [10, 11]);
}

#[tokio::test]
async fn partial_fan_out_is_retried_and_redelivery_is_deduplicated() {
    let consumer = fixture(vec![document(10), document(11)], vec![Step::PartialFailure]);
    run(&consumer).await.unwrap();
    let state = consumer.state.lock().unwrap();
    assert_eq!(state.calls, vec![Uuid::parse_str(EVENT_ID).unwrap(); 3]);
    assert_eq!(state.admitted.len(), 2);
    assert_eq!(state.inserted, [1, 0]);
    assert_eq!(state.committed, [10, 11]);
    assert_eq!(
        state.operations,
        ["ingest", "ingest", "commit", "ingest", "commit"]
    );
}

#[tokio::test]
async fn permanent_domain_rejections_commit_without_retry() {
    for reason in [
        EventRejection::UnsupportedEvent,
        EventRejection::UnsafeAttribution,
    ] {
        let consumer = fixture(vec![document(10)], vec![Step::Reject(reason)]);
        run(&consumer).await.unwrap();
        let state = consumer.state.lock().unwrap();
        assert_eq!(state.calls.len(), 1);
        assert!(state.admitted.is_empty());
        assert_eq!(state.committed, [10]);
    }
}

#[tokio::test]
async fn poison_missing_and_future_payloads_are_rejected_without_ingestion() {
    let mut unknown = envelope("document.future_event");
    unknown["metadata"]["content"] = json!("secret content");
    let payloads = [
        None,
        Some(vec![0xff, 0xfe]),
        Some(b"{invalid private payload".to_vec()),
        Some(serde_json::to_vec(&unknown).unwrap()),
        Some(b"{}".to_vec()),
    ];
    for payload in payloads {
        let consumer = fixture(
            vec![message("macro.documents", payload, Some(vec![]), 10)],
            vec![],
        );
        run(&consumer).await.unwrap();
        let state = consumer.state.lock().unwrap();
        assert!(state.calls.is_empty());
        assert_eq!(state.committed, [10]);
    }
    let consumer = fixture(
        vec![message(
            "macro.documents",
            document(10).payload().map(<[u8]>::to_vec),
            None,
            10,
        )],
        vec![],
    );
    run(&consumer).await.unwrap();
    assert!(consumer.state.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn schema_mismatch_is_an_observable_permanent_reject() {
    let mut payload = envelope("document.created");
    payload["schema_version"] = json!(2);
    let record = message(
        "macro.documents",
        Some(serde_json::to_vec(&payload).unwrap()),
        Some(vec![]),
        10,
    );
    let error = DeclaredMacroEvent::decode(&record).err().unwrap();
    assert_eq!(decode_rejection(&error), "unsupported_schema");
    let consumer = fixture(vec![record, document(11)], vec![]);
    run(&consumer).await.unwrap();
    let state = consumer.state.lock().unwrap();
    assert_eq!(state.calls.len(), 1);
    assert_eq!(state.committed, [10, 11]);
}

#[tokio::test]
async fn exhausted_transient_errors_never_advance_to_the_next_record() {
    let consumer = fixture(
        vec![document(10), document(11)],
        (0..MAX_INGEST_ATTEMPTS)
            .map(|_| Step::PartialFailure)
            .collect(),
    );
    assert!(run(&consumer).await.is_err());
    {
        let state = consumer.state.lock().unwrap();
        assert_eq!(state.calls.len(), usize::from(MAX_INGEST_ATTEMPTS));
        assert_eq!(state.received, [10]);
        assert!(state.commit_attempts.is_empty());
        assert_eq!(state.admitted.len(), 1);
    }
    // A fresh consumer restarts from the uncommitted offset with the same
    // durable rows. The already-admitted first action must not run twice.
    consumer
        .state
        .lock()
        .unwrap()
        .messages
        .push_front(document(10));
    run(&consumer).await.unwrap();
    let state = consumer.state.lock().unwrap();
    assert_eq!(state.admitted.len(), 2);
    assert_eq!(state.inserted, [1, 0]);
    assert_eq!(state.committed, [10, 11]);
}

#[tokio::test]
async fn commit_failure_is_fatal_even_for_a_poison_record() {
    for record in [
        document(10),
        message("macro.documents", None, Some(vec![]), 10),
    ] {
        let consumer = fixture(vec![record, document(11)], vec![]);
        consumer.state.lock().unwrap().fail_commit = true;
        assert!(run(&consumer).await.is_err());
        let state = consumer.state.lock().unwrap();
        assert_eq!(state.received, [10]);
        assert_eq!(state.commit_attempts, [10]);
        assert!(state.committed.is_empty());
    }
}

#[tokio::test]
async fn shutdown_during_admission_or_backoff_never_commits_or_receives_later_work() {
    for step in [Step::ShutdownDuringAdmission, Step::ShutdownBeforeBackoff] {
        let consumer = fixture(vec![document(10), document(11)], vec![step]);
        // Use real backoff here: cancellation must interrupt the delay rather
        // than merely finish after the zero-delay retries used by other tests.
        tokio::time::timeout(
            Duration::from_secs(1),
            consume(
                consumer.clone(),
                FakeIngestion(consumer.clone()),
                consumer.shutdown.cancelled(),
                INGEST_RETRY_BASE_DELAY,
            ),
        )
        .await
        .expect("shutdown did not interrupt admission/backoff")
        .unwrap();
        let state = consumer.state.lock().unwrap();
        assert_eq!(state.calls.len(), 1);
        assert_eq!(state.admitted.len(), 1);
        assert_eq!(state.received, [10]);
        assert!(state.commit_attempts.is_empty());
    }
}

#[tokio::test]
async fn already_cancelled_shutdown_does_not_receive() {
    let consumer = fixture(vec![document(10)], vec![]);
    consumer.shutdown.cancel();
    run(&consumer).await.unwrap();
    assert!(consumer.state.lock().unwrap().received.is_empty());
}

#[test]
fn document_conversion_preserves_the_envelope() {
    let event = incoming_event(DeclaredMacroEvent::decode(&document(10)).unwrap());
    let EventPayload::Document(payload) = event.payload else {
        panic!("expected document payload");
    };
    let original: Event<documents::domain::events::DocumentTopicEvent> =
        serde_json::from_value(envelope("document.created")).unwrap();
    assert_eq!(event.event_id, original.event_id);
    assert_eq!(event.schema_version, original.schema_version);
    assert_eq!(payload, original.event);
}
