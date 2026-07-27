use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use channels::domain::{
    broker_events::{ChannelMessageAttachmentCreatedMetadata, ChannelTopicEvent},
    models::ChannelSender,
};
use chat::domain::events::{ChatMessageRole, ChatMessageSentMetadata, ChatTopicEvent};
use documents::domain::events::{
    DocumentCopiedMetadata, DocumentCreatedMetadata, DocumentDeletedMetadata,
    DocumentInteractionMetadata, DocumentUpdatedMetadata, InteractionReason,
};
use email::domain::events::{EmailEventOrigin, EmailTopicEvent, ThreadReadMetadata};
use macro_event_broker::{Event, EventBrokerError, MacroEventCollection as _, MessageParts};
use macro_user_id::user_id::MacroUserIdStr;
use projects::domain::events::{ProjectTopicEvent, ProjectUpdatedMetadata};
use uuid::Uuid;

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
        DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            actor_user_id: None,
            project_id: None,
        }),
        DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
            document_id: DOCUMENT_ID.to_string(),
            reason: InteractionReason::Edited,
        }),
    ]
}

fn created_event() -> DocumentTopicEvent {
    DocumentTopicEvent::Created(DocumentCreatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user(),
        document_name: "Created".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
        created_at: None,
    })
}

fn copied_event() -> DocumentTopicEvent {
    DocumentTopicEvent::Copied(DocumentCopiedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        source_document_id: "00000000-0000-0000-0000-000000000002".to_string(),
        source_version_id: None,
        owner: user(),
        document_name: "Copied".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
    })
}

#[derive(Clone)]
struct FlakyService {
    attempts: Arc<AtomicU32>,
    failures: u32,
    entities: Arc<Mutex<Vec<Entity<'static>>>>,
}

impl SoupRealtimeService for FlakyService {
    async fn notify_users(&self, update: SoupRealtimeUpdate) -> Result<(), Report> {
        self.entities
            .lock()
            .expect("entities lock")
            .push(update.item);
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
fn subscribes_to_all_existing_soup_source_topics() {
    assert_eq!(
        DeclaredMacroEvent::topics(),
        [
            "macro.documents",
            "macro.projects",
            "macro.chats",
            "macro.email",
            "macro.channels",
        ]
    );
}

#[test]
fn project_updates_only_refresh_root_project_items() {
    let root = ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
        project_id: DOCUMENT_ID.to_string(),
        owner: user(),
        actor_user_id: None,
        name: Some("Renamed".to_string()),
        previous_parent_id: None,
        parent_id: None,
        share_permission_updated: false,
    });
    let nested = ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
        project_id: DOCUMENT_ID.to_string(),
        owner: user(),
        actor_user_id: None,
        name: Some("Renamed".to_string()),
        previous_parent_id: Some(Uuid::now_v7().to_string()),
        parent_id: None,
        share_permission_updated: false,
    });

    let entities = entities_from_project_event(&root);
    assert_eq!(entities.len(), 1);
    assert_eq!(entities[0].item.entity_type, EntityType::Project);
    assert!(entities_from_project_event(&nested).is_empty());
}

#[test]
fn chat_message_events_refresh_the_chat_item() {
    let event = ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
        chat_id: DOCUMENT_ID.to_string(),
        message_id: Uuid::now_v7().to_string(),
        role: ChatMessageRole::Assistant,
        model: "model".to_string(),
        actor_user_id: None,
        attachment_count: 0,
    });

    let entities = entities_from_chat_event(&event);
    assert_eq!(entities.len(), 1);
    assert_eq!(entities[0].item.entity_type, EntityType::Chat);
    assert_eq!(entities[0].item.entity_id, DOCUMENT_ID);
}

#[test]
fn email_thread_state_events_refresh_the_thread_item() {
    let thread_id = Uuid::now_v7();
    let event = EmailTopicEvent::ThreadRead(ThreadReadMetadata {
        link_id: Uuid::now_v7(),
        owner: user(),
        actor: Some(user()),
        thread_id,
        is_read: true,
        origin: EmailEventOrigin::UserAction,
    });

    let entities = entities_from_email_event(&event);
    assert_eq!(entities.len(), 1);
    assert_eq!(entities[0].item.entity_type, EntityType::EmailThread);
    assert_eq!(entities[0].item.entity_id, thread_id.to_string());
}

#[test]
fn channel_attachment_events_refresh_the_channel_and_root_thread() {
    let channel_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    let event =
        ChannelTopicEvent::MessageAttachmentCreated(ChannelMessageAttachmentCreatedMetadata {
            channel_id,
            message_id,
            thread_id: Some(thread_id),
            actor: ChannelSender::new_from_user(user()),
            attachments: Vec::new(),
        });

    let entities = entities_from_channel_event(&event);
    assert_eq!(entities.len(), 2);
    assert_eq!(entities[0].item.entity_type, EntityType::Channel);
    assert_eq!(entities[0].item.entity_id, channel_id.to_string());
    assert_eq!(entities[1].item.entity_type, EntityType::ChannelMessage);
    assert_eq!(entities[1].item.entity_id, thread_id.to_string());
    assert_eq!(entities[1].access_source.entity_type, EntityType::Channel);
    assert_eq!(entities[1].access_source.entity_id, channel_id.to_string());
}

#[test]
fn hydratable_document_creation_events_refresh_the_new_item() {
    for event in [created_event(), copied_event()] {
        let updates = entities_from_document_event(&event);
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].item.entity_type, EntityType::Document);
        assert_eq!(updates[0].item.entity_id, DOCUMENT_ID);
    }
}

#[tokio::test]
async fn updated_payload_maps_to_document_entity() {
    let event = DeclaredMacroEvent::DocumentMacroEvent(DocumentMacroEvent::with_event(
        DOCUMENT_ID,
        updated_event(),
    ));
    let service = flaky_service(0);

    assert!(matches!(
        process_event(&service, &event, 0, 0)
            .await
            .expect("processing succeeds"),
        EventOutcome::Notified
    ));

    let entities = service.entities.lock().expect("entities lock");
    assert_eq!(entities.len(), 1);
    assert_eq!(entities[0].entity_type, EntityType::Document);
    assert_eq!(entities[0].entity_id, DOCUMENT_ID);
}

#[tokio::test]
async fn non_hydratable_document_events_are_ignored() {
    let service = flaky_service(0);
    for event in ignored_events() {
        let event = DeclaredMacroEvent::DocumentMacroEvent(DocumentMacroEvent::with_event(
            DOCUMENT_ID,
            Event::new(event),
        ));
        assert!(matches!(
            process_event(&service, &event, 0, 0)
                .await
                .expect("processing succeeds"),
            EventOutcome::Ignored
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
    let update = SoupRealtimeUpdate::for_entity(
        EntityType::Document.with_entity_string(DOCUMENT_ID.to_string()),
    );

    notify_with_retry(&service, update, 2, 17)
        .await
        .expect("eventual success");

    assert_eq!(service.attempts.load(Ordering::SeqCst), 3);
    assert_eq!(service.entities.lock().expect("entities lock").len(), 3);
}

#[tokio::test(start_paused = true)]
async fn exhausted_retries_return_for_redelivery() {
    let service = flaky_service(u32::MAX);
    let update = SoupRealtimeUpdate::for_entity(
        EntityType::Document.with_entity_string(DOCUMENT_ID.to_string()),
    );

    notify_with_retry(&service, update, 2, 17)
        .await
        .expect_err("persistent failure returns without a commit");

    assert_eq!(
        service.attempts.load(Ordering::SeqCst),
        MAX_SERVICE_ATTEMPTS
    );
}
