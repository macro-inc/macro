use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use documents::domain::events::{
    DocumentCopiedMetadata, DocumentCreatedMetadata, DocumentDeletedMetadata,
    DocumentInteractionMetadata, DocumentUpdatedMetadata, InteractionReason,
};
use macro_event_broker::{Event, EventBrokerError, MacroEventCollection as _, MessageParts};
use macro_user_id::user_id::MacroUserIdStr;

use super::*;

struct TestMessage {
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some(DOCUMENT_ID)
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        "macro.documents"
    }
}

fn decode_payload(payload: Vec<u8>) -> Result<DeclaredMacroEvent, EventBrokerError> {
    DeclaredMacroEvent::decode(&TestMessage { payload })
}

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

fn updated_event() -> Event<DocumentTopicEvent> {
    Event::new(DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user(),
        actor_user_id: None,
        document_name: Some("Updated".to_string()),
        previous_project_id: None,
        project_id: None,
        file_type: None,
        share_permission_updated: false,
    }))
}

fn ignored_events() -> Vec<DocumentTopicEvent> {
    vec![
        DocumentTopicEvent::Created(DocumentCreatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            owner: user(),
            document_name: "Created".to_string(),
            file_type: None,
            project_id: None,
            sub_type: None,
            created_at: None,
        }),
        DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            actor_user_id: None,
            project_id: None,
        }),
        DocumentTopicEvent::Copied(DocumentCopiedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            source_document_id: "00000000-0000-0000-0000-000000000002".to_string(),
            source_version_id: None,
            owner: user(),
            document_name: "Copied".to_string(),
            file_type: None,
            project_id: None,
            sub_type: None,
        }),
        DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
            document_id: DOCUMENT_ID.to_string(),
            reason: InteractionReason::Edited,
        }),
    ]
}

#[derive(Clone)]
struct FlakyService {
    attempts: Arc<AtomicU32>,
    failures: u32,
    entities: Arc<Mutex<Vec<Entity<'static>>>>,
}

impl SoupRealtimeService for FlakyService {
    async fn notify_users(&self, entity: Entity<'static>) -> Result<(), Report> {
        self.entities.lock().expect("entities lock").push(entity);
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst) + 1;
        if attempt <= self.failures {
            Err(rootcause::report!("temporary fan-out failure"))
        } else {
            Ok(())
        }
    }
}

fn flaky_service(failures: u32) -> FlakyService {
    FlakyService {
        attempts: Arc::new(AtomicU32::new(0)),
        failures,
        entities: Arc::new(Mutex::new(Vec::new())),
    }
}

#[test]
fn subscribes_only_to_documents() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.documents"]);
}

#[tokio::test]
async fn updated_payload_maps_to_document_entity() {
    let event = DocumentMacroEvent::with_event(DOCUMENT_ID, updated_event());
    let service = flaky_service(0);

    assert!(matches!(
        process_document_event(&service, &event, 0, 0)
            .await
            .expect("processing succeeds"),
        DocumentEventOutcome::Notified
    ));

    let entities = service.entities.lock().expect("entities lock");
    assert_eq!(entities.len(), 1);
    assert_eq!(entities[0].entity_type, EntityType::Document);
    assert_eq!(entities[0].entity_id, DOCUMENT_ID);
}

#[tokio::test]
async fn non_update_events_are_ignored() {
    let service = flaky_service(0);
    for event in ignored_events() {
        let event = DocumentMacroEvent::with_event(DOCUMENT_ID, Event::new(event));
        assert!(matches!(
            process_document_event(&service, &event, 0, 0)
                .await
                .expect("processing succeeds"),
            DocumentEventOutcome::Ignored
        ));
    }
    assert_eq!(service.attempts.load(Ordering::SeqCst), 0);
}

#[test]
fn malformed_and_unknown_events_are_rejected_by_the_declared_collection() {
    assert!(decode_payload(b"not json".to_vec()).is_err());

    let unknown = serde_json::json!({
        "event_id": "00000000-0000-0000-0000-000000000003",
        "schema_version": 1,
        "event_type": "document.restored",
        "metadata": { "document_id": DOCUMENT_ID }
    });
    let payload = serde_json::to_vec(&unknown).expect("serializable JSON");
    assert!(decode_payload(payload).is_err());
}

#[tokio::test(start_paused = true)]
async fn transient_service_failures_retry_then_succeed() {
    let service = flaky_service(2);
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    notify_with_retry(&service, entity, 2, 17)
        .await
        .expect("eventual success");

    assert_eq!(service.attempts.load(Ordering::SeqCst), 3);
    assert_eq!(service.entities.lock().expect("entities lock").len(), 3);
}

#[tokio::test(start_paused = true)]
async fn exhausted_retries_return_for_redelivery() {
    let service = flaky_service(u32::MAX);
    let entity = EntityType::Document.with_entity_string(DOCUMENT_ID.to_string());

    notify_with_retry(&service, entity, 2, 17)
        .await
        .expect_err("persistent failure returns without a commit");

    assert_eq!(
        service.attempts.load(Ordering::SeqCst),
        MAX_SERVICE_ATTEMPTS
    );
}
