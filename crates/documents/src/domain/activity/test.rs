use ::activity::{Action, activity_id};
use chrono::{TimeZone as _, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use model_entity::EntityType;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{
    DocumentCopiedMetadata, DocumentCreatedMetadata, DocumentDeletedMetadata,
    DocumentInteractionMetadata, DocumentPurgedMetadata, DocumentSyncContentUpdatedMetadata,
    DocumentUpdatedMetadata, InteractionReason,
};

const DOCUMENT_ID: &str = "11111111-1111-1111-1111-111111111111";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: DocumentTopicEvent) -> Event<DocumentTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

fn single_activity(ingest: Ingest) -> Activity {
    match ingest {
        Ingest::Insert(mut activities) => {
            assert_eq!(activities.len(), 1);
            activities.pop().unwrap()
        }
        other => panic!("expected a single activity, got {other:?}"),
    }
}

#[test]
fn created_maps_to_a_created_activity_with_the_metadata_timestamp() {
    let created_at = Utc.with_ymd_and_hms(2026, 8, 5, 12, 0, 0).unwrap();
    let event = envelope(DocumentTopicEvent::Created(DocumentCreatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|creator@example.com"),
        actor: None,
        on_behalf_of: None,
        document_name: "spec".to_string(),
        file_type: Some(FileType::Md),
        project_id: None,
        sub_type: None,
        created_at: Some(created_at),
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Created);
    assert_eq!(activity.subject_id, "macro|creator@example.com");
    assert_eq!(activity.entity_type, EntityType::Document);
    assert_eq!(activity.entity_id, DOCUMENT_ID);
    assert_eq!(activity.occurred_at, created_at);
    assert_eq!(activity.id, activity_id(event.event_id, 0));
    assert_eq!(activity.actor.as_ref(), "macro|creator@example.com");
}

#[test]
fn created_with_system_actor_is_not_the_owner_subject() {
    let event = envelope(DocumentTopicEvent::Created(DocumentCreatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|owner@example.com"),
        actor: Some(Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)),
        on_behalf_of: None,
        document_name: "invoice".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
        created_at: None,
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Created);
    assert_eq!(
        activity.actor.as_ref(),
        bot_id::MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(
        activity.subject_id,
        bot_id::MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref()
    );
}

#[test]
fn created_on_behalf_of_the_owner_stays_on_their_feed() {
    let event = envelope(DocumentTopicEvent::Created(DocumentCreatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|owner@example.com"),
        actor: Some(Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)),
        on_behalf_of: Some(user("macro|owner@example.com")),
        document_name: "welcome".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
        created_at: None,
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(
        activity.actor.as_ref(),
        bot_id::MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(activity.subject_id, "macro|owner@example.com");
}

#[test]
fn attributed_update_and_delete_map_to_activities() {
    let updated = envelope(DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|owner@example.com"),
        actor_user_id: Some(user("macro|editor@example.com")),
        actor: None,
        on_behalf_of: None,
        document_name: Some("renamed".to_string()),
        previous_project_id: None,
        project_id: None,
        file_type: None,
        share_permission_updated: false,
    }));
    let activity = single_activity(updated.event.ingest(updated.event_id));
    assert_eq!(activity.action, Action::Edited);
    assert_eq!(activity.subject_id, "macro|editor@example.com");

    let deleted = envelope(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        actor_user_id: Some(user("macro|editor@example.com")),
        actor: None,
        on_behalf_of: None,
        project_id: None,
    }));
    let activity = single_activity(deleted.event.ingest(deleted.event_id));
    assert_eq!(activity.action, Action::Deleted);
}

#[test]
fn delegated_update_stays_on_the_user_feed() {
    let updated = envelope(DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|owner@example.com"),
        actor_user_id: None,
        actor: Some(Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID)),
        on_behalf_of: Some(user("macro|owner@example.com")),
        document_name: Some("renamed".to_string()),
        previous_project_id: None,
        project_id: None,
        file_type: None,
        share_permission_updated: false,
    }));
    let activity = single_activity(updated.event.ingest(updated.event_id));
    assert_eq!(activity.action, Action::Edited);
    assert_eq!(
        activity.actor.as_ref(),
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(activity.subject_id, "macro|owner@example.com");
}

#[test]
fn unattributable_mutations_are_dropped() {
    let updated = envelope(DocumentTopicEvent::Updated(DocumentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: user("macro|owner@example.com"),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        document_name: None,
        previous_project_id: None,
        project_id: None,
        file_type: None,
        share_permission_updated: true,
    }));
    assert_eq!(updated.event.ingest(updated.event_id), Ingest::Ignore);

    let deleted = envelope(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        actor_user_id: None,
        actor: None,
        on_behalf_of: None,
        project_id: None,
    }));
    assert_eq!(deleted.event.ingest(deleted.event_id), Ingest::Ignore);
}

#[test]
fn copied_maps_to_a_created_activity_for_the_new_document() {
    let event = envelope(DocumentTopicEvent::Copied(DocumentCopiedMetadata {
        document_id: "22222222-2222-2222-2222-222222222222".to_string(),
        source_document_id: DOCUMENT_ID.to_string(),
        source_version_id: None,
        owner: user("macro|copier@example.com"),
        document_name: "copy".to_string(),
        file_type: None,
        project_id: None,
        sub_type: None,
    }));

    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Created);
    assert_eq!(activity.entity_id, "22222222-2222-2222-2222-222222222222");
}

#[test]
fn purge_requests_entity_deletion() {
    let event = envelope(DocumentTopicEvent::Purged(DocumentPurgedMetadata {
        document_id: DOCUMENT_ID.to_string(),
    }));

    assert_eq!(
        event.event.ingest(event.event_id),
        Ingest::Purge(vec![(EntityType::Document, DOCUMENT_ID.to_string())])
    );
}

#[test]
fn pipeline_and_session_events_are_ignored() {
    let sync = envelope(DocumentTopicEvent::SyncContentUpdated(
        DocumentSyncContentUpdatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: None,
            actor: None,
            on_behalf_of: None,
        },
    ));
    assert_eq!(sync.event.ingest(sync.event_id), Ingest::Ignore);

    let interaction = envelope(DocumentTopicEvent::Interaction(
        DocumentInteractionMetadata {
            document_id: DOCUMENT_ID.to_string(),
            reason: InteractionReason::FirstJoin,
        },
    ));
    assert_eq!(
        interaction.event.ingest(interaction.event_id),
        Ingest::Ignore
    );
}

#[test]
fn attributed_sync_content_is_an_edited_activity() {
    let event = envelope(DocumentTopicEvent::SyncContentUpdated(
        DocumentSyncContentUpdatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: None,
            actor: Some(Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID)),
            on_behalf_of: Some(user("macro|owner@example.com")),
        },
    ));
    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Edited);
    assert_eq!(
        activity.actor.as_ref(),
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(activity.subject_id, "macro|owner@example.com");
}

#[test]
fn replaying_an_event_derives_identical_activity_ids() {
    let event = envelope(DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        actor_user_id: Some(user("macro|editor@example.com")),
        actor: None,
        on_behalf_of: None,
        project_id: None,
    }));

    let first = single_activity(event.event.ingest(event.event_id));
    let second = single_activity(event.event.ingest(event.event_id));
    assert_eq!(first.id, second.id);
}
