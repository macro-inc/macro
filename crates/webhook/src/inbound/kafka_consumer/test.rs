use super::*;
use crate::domain::{
    events::{WebhookDeletedMetadata, WebhookTopicEvent},
    ingestion::WebhookEventIngestionError,
};
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelDeletedMetadata;
use documents::domain::events::DocumentDeletedMetadata;
use macro_user_id::user_id::MacroUserIdStr;
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

fn webhook_event() -> Event<WebhookTopicEvent> {
    Event::new(WebhookTopicEvent::Deleted(WebhookDeletedMetadata {
        webhook_id: "wh_1".to_string(),
        workspace_id: "macro|owner@example.com".to_string(),
        actor_user_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string())
            .expect("valid user id"),
    }))
}

#[test]
fn subscribes_to_all_ingestion_topics() {
    assert_eq!(
        subscribed_topics(),
        ["macro.documents", "macro.channels", "macro.webhooks"]
    );
}

#[test]
fn decodes_document_events() {
    let event = document_event();
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded =
        WebhookConsumerEvent::decode(MacroDocumentsTopic.as_str(), &payload).expect("decodable");

    match decoded {
        WebhookConsumerEvent::Documents(decoded) => assert_eq!(decoded, event),
        WebhookConsumerEvent::Channels(_) | WebhookConsumerEvent::Webhooks(_) => {
            panic!("decoded into the wrong topic variant")
        }
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
        WebhookConsumerEvent::Documents(_) | WebhookConsumerEvent::Webhooks(_) => {
            panic!("decoded into the wrong topic variant")
        }
    }
}

#[test]
fn decodes_webhook_events() {
    let event = webhook_event();
    let payload = serde_json::to_vec(&event).expect("serializable");

    let decoded =
        WebhookConsumerEvent::decode(MacroWebhooksTopic.as_str(), &payload).expect("decodable");

    match decoded {
        WebhookConsumerEvent::Webhooks(decoded) => assert_eq!(decoded, event),
        WebhookConsumerEvent::Documents(_) | WebhookConsumerEvent::Channels(_) => {
            panic!("decoded into the wrong topic variant")
        }
    }
}

#[test]
fn rejects_unknown_topics() {
    let err = WebhookConsumerEvent::decode("macro.example", b"{}").expect_err("unknown topic");
    assert!(matches!(err, EventBrokerError::UnknownTopic(topic) if topic == "macro.example"));
}

#[test]
fn rejects_malformed_webhook_payloads() {
    let err = WebhookConsumerEvent::decode(MacroWebhooksTopic.as_str(), b"not json")
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

    ingest_with_retry(
        &service,
        &WebhookConsumerEvent::Webhooks(webhook_event()),
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
        &WebhookConsumerEvent::Webhooks(webhook_event()),
        0,
        0,
    )
    .await
    .expect_err("persistent transient failure aborts the consumer without committing");

    assert_eq!(attempts.load(Ordering::SeqCst), MAX_INGEST_ATTEMPTS);
}

#[tokio::test]
async fn permanent_webhook_failures_are_commit_safe_without_retry() {
    let (service, attempts) = flaky_service(u32::MAX, false);

    ingest_with_retry(
        &service,
        &WebhookConsumerEvent::Webhooks(webhook_event()),
        0,
        0,
    )
    .await
    .expect("permanent failures are skipped so the offset commits");

    assert_eq!(attempts.load(Ordering::SeqCst), 1);
}
