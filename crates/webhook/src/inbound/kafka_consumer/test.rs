use super::*;
use crate::domain::ingestion::WebhookEventIngestionError;
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelDeletedMetadata;
use documents::domain::events::DocumentDeletedMetadata;
use entity_access::domain::models::AccessError;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use uuid::Uuid;

fn document_event() -> Event<DocumentTopicEvent> {
    Event::new(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: "doc_1".to_string(),
        actor_user_id: None,
        project_id: None,
    }))
}

#[test]
fn decodes_document_events() {
    let event = document_event();
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded =
        WebhookConsumerEvent::decode(MacroDocumentsTopic.as_str(), &payload).expect("decodable");

    match decoded {
        WebhookConsumerEvent::Documents(decoded) => assert_eq!(decoded, event),
        WebhookConsumerEvent::Channels(_) => panic!("decoded into the wrong topic variant"),
    }
}

#[test]
fn decodes_channel_events() {
    let event = Event::new(ChannelTopicEvent::Deleted(ChannelDeletedMetadata {
        channel_id: Uuid::nil(),
        actor: ChannelSender::try_from("macro|owner@example.com".to_string())
            .expect("valid channel sender"),
    }));
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded =
        WebhookConsumerEvent::decode(MacroChannelsTopic.as_str(), &payload).expect("decodable");

    match decoded {
        WebhookConsumerEvent::Channels(decoded) => assert_eq!(decoded, event),
        WebhookConsumerEvent::Documents(_) => panic!("decoded into the wrong topic variant"),
    }
}

#[test]
fn rejects_unknown_topics() {
    let err = WebhookConsumerEvent::decode("macro.example", b"{}").expect_err("unknown topic");
    assert!(matches!(err, EventBrokerError::UnknownTopic(topic) if topic == "macro.example"));
}

#[test]
fn rejects_malformed_payloads() {
    let err = WebhookConsumerEvent::decode(MacroDocumentsTopic.as_str(), b"not json")
        .expect_err("malformed payload");
    assert!(matches!(err, EventBrokerError::Serialization(_)));
}

/// Ingestion service that fails the first `failures` attempts, then succeeds.
#[derive(Clone)]
struct FlakyIngestionService {
    attempts: Arc<AtomicU32>,
    failures: u32,
    transient: bool,
}

impl FlakyIngestionService {
    fn failure(&self) -> WebhookEventIngestionError {
        if self.transient {
            WebhookEventIngestionError::Enqueue(anyhow::anyhow!("queue unavailable"))
        } else {
            WebhookEventIngestionError::EntityAccess(AccessError::Unauthorized)
        }
    }
}

impl WebhookEventIngestionService for FlakyIngestionService {
    async fn ingest_document_event(
        &self,
        _event: Event<DocumentTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
        if attempt <= self.failures {
            Err(self.failure())
        } else {
            Ok(())
        }
    }

    async fn ingest_channel_event(
        &self,
        _event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        Ok(())
    }
}

fn flaky_service(failures: u32, transient: bool) -> (FlakyIngestionService, Arc<AtomicU32>) {
    let attempts = Arc::new(AtomicU32::new(0));
    let service = FlakyIngestionService {
        attempts: attempts.clone(),
        failures,
        transient,
    };
    (service, attempts)
}

// `start_paused` auto-advances the tokio clock through the backoff sleeps.
#[tokio::test(start_paused = true)]
async fn retries_transient_failures_until_success() {
    let (service, attempts) = flaky_service(2, true);

    ingest_with_retry(
        &service,
        &WebhookConsumerEvent::Documents(document_event()),
        0,
        0,
    )
    .await
    .expect("succeeds once the transient failure clears");

    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test(start_paused = true)]
async fn exhausted_transient_retries_bubble_up_for_redelivery() {
    let (service, attempts) = flaky_service(u32::MAX, true);

    ingest_with_retry(
        &service,
        &WebhookConsumerEvent::Documents(document_event()),
        0,
        0,
    )
    .await
    .expect_err("persistent transient failure aborts the consumer without committing");

    assert_eq!(attempts.load(Ordering::SeqCst), MAX_INGEST_ATTEMPTS);
}

#[tokio::test]
async fn permanent_failures_are_dropped_without_retry() {
    let (service, attempts) = flaky_service(u32::MAX, false);

    ingest_with_retry(
        &service,
        &WebhookConsumerEvent::Documents(document_event()),
        0,
        0,
    )
    .await
    .expect("permanent failures are skipped so the offset commits");

    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}
