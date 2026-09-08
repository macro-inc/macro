use super::*;
use crate::domain::{
    events::{WebhookDeletedMetadata, WebhookMacroEvent, WebhookTopicEvent},
    ingestion::WebhookEventIngestionError,
};
use channel_sender::ChannelSender;
use channels::domain::broker_events::{ChannelDeletedMetadata, ChannelTopicEvent};
use documents::domain::events::{DocumentDeletedMetadata, DocumentTopicEvent};
use macro_event_broker::{
    Event, EventBrokerError, MacroEvent as _, MacroEventCollection as _, MessageParts,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use uuid::Uuid;

struct TestMessage<'a> {
    topic: &'a str,
    payload: &'a [u8],
}

impl MessageParts for TestMessage<'_> {
    fn key(&self) -> Option<&str> {
        Some("event-key")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(self.payload)
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

fn decode_message(topic: &str, payload: &[u8]) -> Result<DeclaredMacroEvent, EventBrokerError> {
    DeclaredMacroEvent::decode(&TestMessage { topic, payload })
}

fn document_event() -> Event<DocumentTopicEvent> {
    Event::new(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: "doc_1".to_string(),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        project_id: None,
    }))
}

fn webhook_event() -> Event<WebhookTopicEvent> {
    Event::new(WebhookTopicEvent::Deleted(WebhookDeletedMetadata {
        webhook_id: "wh_1".to_string(),
        workspace_id: "macro|owner@example.com".to_string(),
        actor_user_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string())
            .expect("valid user id"),
    }))
}

fn declared_webhook_event() -> DeclaredMacroEvent {
    DeclaredMacroEvent::WebhookMacroEvent(WebhookMacroEvent::with_event("wh_1", webhook_event()))
}

#[test]
fn subscribes_to_all_ingestion_topics() {
    assert_eq!(
        DeclaredMacroEvent::topics(),
        [
            "macro.documents",
            "macro.channels",
            "macro.webhooks",
            "macro.agent_sessions"
        ]
    );
}

#[test]
fn decodes_document_events() {
    let event = document_event();
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded = decode_message("macro.documents", &payload).expect("decodable");

    match decoded {
        DeclaredMacroEvent::DocumentMacroEvent(decoded) => assert_eq!(decoded.event(), &event),
        _ => panic!("decoded into the wrong topic variant"),
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

    let decoded = decode_message("macro.channels", &payload).expect("decodable");

    match decoded {
        DeclaredMacroEvent::ChannelMacroEvent(decoded) => assert_eq!(decoded.event(), &event),
        _ => panic!("decoded into the wrong topic variant"),
    }
}

#[test]
fn decodes_webhook_events() {
    let event = webhook_event();
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded = decode_message("macro.webhooks", &payload).expect("decodable");

    match decoded {
        DeclaredMacroEvent::WebhookMacroEvent(decoded) => assert_eq!(decoded.event(), &event),
        _ => panic!("decoded into the wrong topic variant"),
    }
}

#[test]
fn rejects_unknown_topics() {
    let err = decode_message("macro.example", b"{}")
        .err()
        .expect("unknown topic");
    assert!(matches!(err, EventBrokerError::UnknownTopic(topic) if topic == "macro.example"));
}

#[test]
fn rejects_malformed_webhook_payloads() {
    let err = decode_message("macro.webhooks", b"not json")
        .err()
        .expect("malformed payload");
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
            WebhookEventIngestionError::InvalidEntityId {
                entity_type: "webhook",
                entity_id: "invalid".to_string(),
            }
        }
    }

    fn ingest(&self) -> Result<(), WebhookEventIngestionError> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
        if attempt <= self.failures {
            Err(self.failure())
        } else {
            Ok(())
        }
    }
}

impl WebhookEventIngestionService for FlakyIngestionService {
    async fn ingest_document_event(
        &self,
        _event: Event<DocumentTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        Ok(())
    }

    async fn ingest_channel_event(
        &self,
        _event: Event<ChannelTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        Ok(())
    }

    async fn ingest_webhook_event(
        &self,
        _event: Event<WebhookTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest()
    }

    async fn ingest_agent_trigger_event(
        &self,
        _event: Event<agent_trigger::domain::broker_events::AgentTriggerTopicEvent>,
    ) -> Result<(), WebhookEventIngestionError> {
        self.ingest()
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
async fn retries_transient_webhook_failures_until_success() {
    let (service, attempts) = flaky_service(2, true);

    ingest_with_retry(&service, &declared_webhook_event(), 0, 0)
        .await
        .expect("succeeds once the transient failure clears");

    assert_eq!(attempts.load(Ordering::SeqCst), 3);
}

#[tokio::test(start_paused = true)]
async fn exhausted_transient_retries_bubble_up_for_redelivery() {
    let (service, attempts) = flaky_service(u32::MAX, true);

    ingest_with_retry(&service, &declared_webhook_event(), 0, 0)
        .await
        .expect_err("persistent transient failure aborts the consumer without committing");

    assert_eq!(attempts.load(Ordering::SeqCst), MAX_INGEST_ATTEMPTS);
}

#[tokio::test]
async fn permanent_webhook_failures_are_commit_safe_without_retry() {
    let (service, attempts) = flaky_service(u32::MAX, false);

    ingest_with_retry(&service, &declared_webhook_event(), 0, 0)
        .await
        .expect("permanent failures are skipped so the offset commits");

    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}
