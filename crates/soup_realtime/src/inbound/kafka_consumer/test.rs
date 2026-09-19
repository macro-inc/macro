use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use channels::domain::{
    broker_events::{
        ChannelEventAttachment, ChannelMessageAttachmentCreatedMetadata,
        ChannelMessageDeletedMetadata, ChannelMessagePostedMetadata, ChannelTopicEvent,
    },
    models::{ChannelSender, ChannelType, SimpleMention},
};
use chat::domain::events::{ChatMessageDeletedMetadata, ChatTopicEvent, ChatUpdatedMetadata};
use chrono::Utc;
use documents::domain::events::{
    DocumentContentUploadedMetadata, DocumentCreatedMetadata, DocumentDeletedMetadata,
    DocumentInteractionMetadata, DocumentPurgedMetadata, DocumentSyncContentUpdatedMetadata,
    DocumentUpdatedMetadata, InteractionReason,
};
use email::domain::events::{
    EmailEventOrigin, EmailTopicEvent, MessageDraftSyncedMetadata, ThreadBackfilledMetadata,
    ThreadReadMetadata, ThreadSpamChangedMetadata, ThreadTrashedMetadata, ThreadsReindexReason,
    ThreadsReindexRequestedMetadata,
};
use macro_event_broker::{Event, EventBrokerError, MacroEventCollection as _, MessageParts};
use macro_user_id::user_id::MacroUserIdStr;
use projects::domain::events::{ProjectDeletedMetadata, ProjectTopicEvent};
use properties::domain::events::{
    EntityPropertiesClearedMetadata, EntityPropertyDeletedMetadata, EntityPropertyUpdatedMetadata,
};
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
        actor: None,
        on_behalf_of: None,
        document_name: Some("Updated".to_string()),
        previous_project_id: None,
        project_id: None,
        file_type: None,
        share_permission_updated: false,
    }))
}

fn patch_entity(patch: &SoupRealtimePatch) -> &Entity<'static> {
    patch.patch.value()
}

#[derive(Clone)]
struct FlakyService {
    attempts: Arc<AtomicU32>,
    failures: u32,
    patches: Arc<Mutex<Vec<SoupRealtimePatch>>>,
}

impl SoupRealtimeService for FlakyService {
    fn notify_users(&self, patch: SoupRealtimePatch) -> Result<(), Report> {
        self.patches.lock().expect("patches lock").push(patch);
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
        patches: Arc::new(Mutex::new(Vec::new())),
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
            "macro.properties",
        ]
    );
}

#[test]
fn document_lifecycle_events_map_to_updated_and_deleted_patches() {
    let created = DocumentTopicEvent::Created(DocumentCreatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user(),
        actor: None,
        on_behalf_of: None,
        document_name: "Created".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
        created_at: None,
    });
    let deleted = DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        project_id: None,
    });

    let created = patches_from_document_event(&created);
    assert!(matches!(created[0].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&created[0]).entity_type, EntityType::Document);

    let deleted = patches_from_document_event(&deleted);
    assert!(matches!(deleted[0].patch, Patch::Deleted(_)));
    assert_eq!(patch_entity(&deleted[0]).entity_id, DOCUMENT_ID);
}

#[test]
fn moving_a_document_out_of_a_project_updates_the_previous_project() {
    let previous_project_id = Uuid::now_v7().to_string();
    let event = DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user(),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        document_name: None,
        previous_project_id: Some(previous_project_id.clone()),
        project_id: None,
        file_type: None,
        share_permission_updated: false,
    });

    let patches = patches_from_document_event(&event);
    assert_eq!(patches.len(), 2);
    assert!(matches!(patches[1].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&patches[1]).entity_type, EntityType::Project);
    assert_eq!(patch_entity(&patches[1]).entity_id, previous_project_id);
}

#[test]
fn document_edit_interactions_map_to_updated_patches() {
    let edited = DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
        document_id: DOCUMENT_ID.to_string(),
        reason: InteractionReason::Edited,
    });
    let first_join = DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
        document_id: DOCUMENT_ID.to_string(),
        reason: InteractionReason::FirstJoin,
    });

    assert!(matches!(
        patches_from_document_event(&edited)[0].patch,
        Patch::Updated(_)
    ));
    assert!(patches_from_document_event(&first_join).is_empty());
}

#[test]
fn search_only_document_events_do_not_emit_patches() {
    let events = [
        DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            owner: user(),
            file_type: "pdf".parse().expect("valid file type"),
            document_version_id: Some("convert".to_string()),
        }),
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            file_type: "md".parse().expect("valid file type"),
            document_version_id: None,
            actor: None,
            on_behalf_of: None,
        }),
        DocumentTopicEvent::Purged(DocumentPurgedMetadata {
            document_id: DOCUMENT_ID.to_string(),
        }),
    ];

    for event in events {
        assert!(patches_from_document_event(&event).is_empty());
    }
}

#[test]
fn project_deletion_maps_cascade_entities_to_deleted_patches() {
    let project_id = Uuid::now_v7().to_string();
    let child_id = Uuid::now_v7().to_string();
    let document_id = Uuid::now_v7().to_string();
    let chat_id = Uuid::now_v7().to_string();
    let event = ProjectTopicEvent::Deleted(ProjectDeletedMetadata {
        project_id: project_id.clone(),
        owner: user(),
        actor_user_id: None,
        parent_project_id: None,
        deleted_project_ids: vec![project_id.clone(), child_id.clone()],
        deleted_document_ids: vec![document_id.clone()],
        deleted_chat_ids: vec![chat_id.clone()],
    });

    let patches = patches_from_project_event(&event);
    assert_eq!(patches.len(), 4);
    assert!(
        patches
            .iter()
            .all(|patch| matches!(patch.patch, Patch::Deleted(_)))
    );
    let entities = patches
        .iter()
        .map(patch_entity)
        .map(|entity| (entity.entity_type, entity.entity_id.as_ref()))
        .collect::<Vec<_>>();
    assert!(entities.contains(&(EntityType::Project, project_id.as_str())));
    assert!(entities.contains(&(EntityType::Project, child_id.as_str())));
    assert!(entities.contains(&(EntityType::Document, document_id.as_str())));
    assert!(entities.contains(&(EntityType::Chat, chat_id.as_str())));
}

#[test]
fn chat_metadata_events_map_to_updated_patches() {
    let event = ChatTopicEvent::Updated(ChatUpdatedMetadata {
        chat_id: DOCUMENT_ID.to_string(),
        actor_user_id: user(),
        name: Some("Renamed".to_string()),
        previous_project_id: None,
        project_id: None,
        share_permission_updated: false,
    });

    let patches = patches_from_chat_event(&event);
    assert_eq!(patches.len(), 1);
    assert!(matches!(patches[0].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&patches[0]).entity_type, EntityType::Chat);
}

#[test]
fn moving_a_chat_out_of_a_project_updates_the_previous_project() {
    let previous_project_id = Uuid::now_v7().to_string();
    let event = ChatTopicEvent::Updated(ChatUpdatedMetadata {
        chat_id: DOCUMENT_ID.to_string(),
        actor_user_id: user(),
        name: None,
        previous_project_id: Some(previous_project_id.clone()),
        project_id: None,
        share_permission_updated: false,
    });

    let patches = patches_from_chat_event(&event);
    assert_eq!(patches.len(), 2);
    assert!(matches!(patches[1].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&patches[1]).entity_type, EntityType::Project);
    assert_eq!(patch_entity(&patches[1]).entity_id, previous_project_id);
}

#[test]
fn deleted_chat_messages_do_not_change_soup() {
    let event = ChatTopicEvent::MessageDeleted(ChatMessageDeletedMetadata {
        chat_id: DOCUMENT_ID.to_string(),
        message_id: Uuid::now_v7().to_string(),
    });

    assert!(patches_from_chat_event(&event).is_empty());
}

#[test]
fn task_property_updates_map_to_document_updates() {
    let event = PropertyTopicEvent::EntityPropertyUpdated(EntityPropertyUpdatedMetadata {
        entity_property_id: Uuid::now_v7(),
        entity_id: DOCUMENT_ID.to_string(),
        entity_type: PropertyEntityType::Task,
        property_definition_id: Uuid::now_v7(),
        actor_user_id: Some(user()),
        actor: None,
        on_behalf_of: None,
        value: None,
        previous_value: None,
        updated_at: Utc::now(),
    });

    let patches = patches_from_property_event(&event);
    assert_eq!(patches.len(), 1);
    assert!(matches!(patches[0].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&patches[0]).entity_type, EntityType::Document);
    assert_eq!(patch_entity(&patches[0]).entity_id, DOCUMENT_ID);
}

#[test]
fn deleting_or_clearing_properties_updates_the_soup_entity() {
    let thread_id = Uuid::now_v7().to_string();
    let deleted = PropertyTopicEvent::EntityPropertyDeleted(EntityPropertyDeletedMetadata {
        entity_property_id: Uuid::now_v7(),
        entity_id: thread_id.clone(),
        entity_type: PropertyEntityType::Thread,
        property_definition_id: Uuid::now_v7(),
        actor_user_id: Some(user()),
        actor: None,
        on_behalf_of: None,
    });
    let company_id = Uuid::now_v7().to_string();
    let cleared = PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
        entity_id: company_id.clone(),
        entity_type: PropertyEntityType::Company,
        actor_user_id: Some(user()),
        actor: None,
        on_behalf_of: None,
    });

    let deleted = patches_from_property_event(&deleted);
    assert!(matches!(deleted[0].patch, Patch::Updated(_)));
    assert_eq!(
        patch_entity(&deleted[0]).entity_type,
        EntityType::EmailThread
    );
    assert_eq!(patch_entity(&deleted[0]).entity_id, thread_id);

    let cleared = patches_from_property_event(&cleared);
    assert!(matches!(cleared[0].patch, Patch::Updated(_)));
    assert_eq!(
        patch_entity(&cleared[0]).entity_type,
        EntityType::CrmCompany
    );
    assert_eq!(patch_entity(&cleared[0]).entity_id, company_id);
}

#[test]
fn property_events_for_non_property_soup_items_are_ignored() {
    for entity_type in [PropertyEntityType::Channel, PropertyEntityType::User] {
        let event = PropertyTopicEvent::EntityPropertiesCleared(EntityPropertiesClearedMetadata {
            entity_id: DOCUMENT_ID.to_string(),
            entity_type,
            actor_user_id: Some(user()),
            actor: None,
            on_behalf_of: None,
        });
        assert!(patches_from_property_event(&event).is_empty());
    }
}

#[test]
fn email_state_events_map_to_updated_or_deleted_patches() {
    let thread_id = Uuid::now_v7();
    let read = EmailTopicEvent::ThreadRead(ThreadReadMetadata {
        link_id: Uuid::now_v7(),
        owner: user(),
        actor: Some(user()),
        thread_id,
        is_read: true,
        origin: EmailEventOrigin::UserAction,
    });
    let trashed = EmailTopicEvent::ThreadTrashed(ThreadTrashedMetadata {
        link_id: Uuid::now_v7(),
        owner: user(),
        actor: Some(user()),
        thread_id,
        trashed: true,
        origin: EmailEventOrigin::UserAction,
    });

    assert!(matches!(
        patches_from_email_event(&read)[0].patch,
        Patch::Updated(_)
    ));
    assert!(matches!(
        patches_from_email_event(&trashed)[0].patch,
        Patch::Deleted(_)
    ));
}

#[test]
fn new_email_events_map_to_realtime_thread_patches() {
    let link_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    let second_thread_id = Uuid::now_v7();

    let visible_draft = EmailTopicEvent::MessageDraftSynced(MessageDraftSyncedMetadata {
        link_id,
        owner: user(),
        message_id: Uuid::now_v7(),
        provider_message_id: "message-id".to_string(),
        thread_id,
        provider_thread_id: "thread-id".to_string(),
        is_spam_or_trash: false,
    });
    let hidden_draft = EmailTopicEvent::MessageDraftSynced(MessageDraftSyncedMetadata {
        link_id,
        owner: user(),
        message_id: Uuid::now_v7(),
        provider_message_id: "hidden-message-id".to_string(),
        thread_id,
        provider_thread_id: "thread-id".to_string(),
        is_spam_or_trash: true,
    });
    let marked_spam = EmailTopicEvent::ThreadSpamChanged(ThreadSpamChangedMetadata {
        link_id,
        owner: user(),
        actor: Some(user()),
        thread_id,
        spam: true,
        origin: EmailEventOrigin::UserAction,
    });
    let restored_from_spam = EmailTopicEvent::ThreadSpamChanged(ThreadSpamChangedMetadata {
        link_id,
        owner: user(),
        actor: Some(user()),
        thread_id,
        spam: false,
        origin: EmailEventOrigin::UserAction,
    });
    let backfilled = EmailTopicEvent::ThreadBackfilled(ThreadBackfilledMetadata {
        link_id,
        owner: user(),
        thread_id,
    });
    let reindex_requested =
        EmailTopicEvent::ThreadsReindexRequested(ThreadsReindexRequestedMetadata {
            link_id,
            owner: user(),
            thread_ids: vec![thread_id, second_thread_id],
            reason: ThreadsReindexReason::ContactsChanged,
        });

    assert!(matches!(
        patches_from_email_event(&visible_draft)[0].patch,
        Patch::Updated(_)
    ));
    assert!(patches_from_email_event(&hidden_draft).is_empty());
    assert!(matches!(
        patches_from_email_event(&marked_spam)[0].patch,
        Patch::Deleted(_)
    ));
    assert!(matches!(
        patches_from_email_event(&restored_from_spam)[0].patch,
        Patch::Updated(_)
    ));
    assert!(matches!(
        patches_from_email_event(&backfilled)[0].patch,
        Patch::Updated(_)
    ));

    let reindex_patches = patches_from_email_event(&reindex_requested);
    assert_eq!(reindex_patches.len(), 2);
    assert_eq!(
        patch_entity(&reindex_patches[0]).entity_id,
        thread_id.to_string()
    );
    assert_eq!(
        patch_entity(&reindex_patches[1]).entity_id,
        second_thread_id.to_string()
    );
}

#[test]
fn attachment_events_update_referenced_documents_for_channel_members() {
    let channel_id = Uuid::now_v7();
    let event =
        ChannelTopicEvent::MessageAttachmentCreated(ChannelMessageAttachmentCreatedMetadata {
            channel_id,
            message_id: Uuid::now_v7(),
            actor: ChannelSender::new_from_user(user()),
            attachments: vec![ChannelEventAttachment {
                attachment_id: Uuid::now_v7(),
                entity_type: "document".to_string(),
                entity_id: DOCUMENT_ID.to_string(),
                created_at: Utc::now(),
            }],
        });

    let patches = patches_from_channel_event(&event);
    assert_eq!(patches.len(), 2);
    assert_eq!(patch_entity(&patches[0]).entity_type, EntityType::Channel);
    assert_eq!(patch_entity(&patches[0]).entity_id, channel_id.to_string());
    assert_eq!(patch_entity(&patches[1]).entity_type, EntityType::Document);
    assert_eq!(patch_entity(&patches[1]).entity_id, DOCUMENT_ID);
    assert_eq!(patches[1].access_source.entity_type, EntityType::Channel);
    assert_eq!(patches[1].access_source.entity_id, channel_id.to_string());
}

#[test]
fn posted_message_mentions_update_referenced_documents_for_channel_members() {
    let channel_id = Uuid::now_v7();
    let event = ChannelTopicEvent::MessagePosted(ChannelMessagePostedMetadata {
        channel_id,
        message_id: Uuid::now_v7(),
        thread_id: None,
        sender: ChannelSender::new_from_user(user()),
        triggered_by: None,
        channel_type: ChannelType::Private,
        content: "shared a document".to_string(),
        mentions: vec![SimpleMention {
            entity_type: "document".to_string(),
            entity_id: DOCUMENT_ID.to_string(),
        }],
        attachments: Vec::new(),
        created_at: Utc::now(),
    });

    let patches = patches_from_channel_event(&event);
    assert_eq!(patches.len(), 3);
    assert_eq!(patch_entity(&patches[2]).entity_type, EntityType::Document);
    assert_eq!(patch_entity(&patches[2]).entity_id, DOCUMENT_ID);
    assert_eq!(patches[2].access_source.entity_type, EntityType::Channel);
    assert_eq!(patches[2].access_source.entity_id, channel_id.to_string());
}

#[test]
fn deleting_a_root_channel_message_deletes_its_thread_patch() {
    let channel_id = Uuid::now_v7();
    let message_id = Uuid::now_v7();
    let event = ChannelTopicEvent::MessageDeleted(ChannelMessageDeletedMetadata {
        channel_id,
        message_id,
        thread_id: None,
        actor: ChannelSender::new_from_user(user()),
        deleted_at: None,
    });

    let patches = patches_from_channel_event(&event);
    assert_eq!(patches.len(), 2);
    assert!(matches!(patches[0].patch, Patch::Updated(_)));
    assert!(matches!(patches[1].patch, Patch::Deleted(_)));
    assert_eq!(patch_entity(&patches[1]).entity_id, message_id.to_string());
    assert_eq!(patches[1].access_source.entity_type, EntityType::Channel);
}

#[test]
fn updated_payload_maps_to_document_patch() {
    let event = DeclaredMacroEvent::DocumentMacroEvent(DocumentMacroEvent::with_event(
        DOCUMENT_ID,
        updated_event(),
    ));
    let service = flaky_service(0);

    assert!(matches!(
        process_event(&service, &event).expect("processing succeeds"),
        EventOutcome::Notified
    ));

    let patches = service.patches.lock().expect("patches lock");
    assert_eq!(patches.len(), 1);
    assert!(matches!(patches[0].patch, Patch::Updated(_)));
    assert_eq!(patch_entity(&patches[0]).entity_id, DOCUMENT_ID);
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

#[test]
fn service_failure_is_returned_without_retry() {
    let event = DeclaredMacroEvent::DocumentMacroEvent(DocumentMacroEvent::with_event(
        DOCUMENT_ID,
        updated_event(),
    ));
    let service = flaky_service(1);

    assert!(process_event(&service, &event).is_err());

    assert_eq!(service.attempts.load(Ordering::SeqCst), 1);
    assert_eq!(service.patches.lock().expect("patches lock").len(), 1);
}
