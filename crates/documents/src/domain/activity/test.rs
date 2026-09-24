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
use model_owner::Owner;

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
        owner: Owner::from_principal_str("macro|creator@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|owner@example.com").unwrap(),
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
        owner: Owner::from_principal_str("macro|copier@example.com").unwrap(),
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
fn creation_and_copy_derive_user_bot_and_team_actors() {
    let user = user("macro|creator@example.com");
    let bot = bot_id::MACRO_AI_BOT_ID;
    let system = Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID);
    for (owner, expected_actor) in [
        (Owner::User(user.clone()), Actor::new_from_user(user)),
        (Owner::Bot(bot), Actor::new_from_bot(bot)),
        (Owner::Team(Uuid::from_u128(1)), system),
    ] {
        let events = [
            DocumentTopicEvent::Created(DocumentCreatedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                owner: owner.clone(),
                actor: None,
                on_behalf_of: None,
                document_name: "notes".to_string(),
                file_type: None,
                project_id: None,
                sub_type: None,
                created_at: None,
            }),
            DocumentTopicEvent::Copied(DocumentCopiedMetadata {
                document_id: DOCUMENT_ID.to_string(),
                source_document_id: "source-document".to_string(),
                source_version_id: None,
                owner,
                document_name: "copy".to_string(),
                file_type: None,
                project_id: None,
                sub_type: None,
            }),
        ];
        for event in events {
            let event = envelope(event);
            let activity = single_activity(event.event.ingest(event.event_id));
            assert_eq!(activity.action, Action::Created);
            assert_eq!(activity.actor, expected_actor);
            assert_eq!(activity.subject_id, expected_actor.as_ref());
            assert_eq!(activity.entity_id, DOCUMENT_ID);
            assert_eq!(activity.occurred_at, event_time(event.event_id));
        }
    }
}

#[test]
fn team_creation_prefers_explicit_actor_then_on_behalf_of_then_system() {
    let initiating_user = user("macro|creator@example.com");
    let user_actor = Actor::new_from_user(initiating_user.clone());
    let bot_actor = Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID);
    let system_actor = Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID);
    for (actor, on_behalf_of, expected_actor, expected_subject) in [
        (
            Some(bot_actor.clone()),
            Some(initiating_user.clone()),
            bot_actor.clone(),
            initiating_user.to_string(),
        ),
        (
            Some(bot_actor.clone()),
            None,
            bot_actor.clone(),
            bot_actor.as_ref().to_string(),
        ),
        (
            Some(user_actor.clone()),
            None,
            user_actor.clone(),
            initiating_user.to_string(),
        ),
        (
            None,
            Some(initiating_user.clone()),
            user_actor,
            initiating_user.to_string(),
        ),
        (
            None,
            None,
            system_actor.clone(),
            system_actor.as_ref().to_string(),
        ),
    ] {
        let event = envelope(DocumentTopicEvent::Created(DocumentCreatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            owner: Owner::Team(Uuid::from_u128(1)),
            actor,
            on_behalf_of,
            document_name: "team notes".to_string(),
            file_type: None,
            project_id: None,
            sub_type: None,
            created_at: None,
        }));
        let activity = single_activity(event.event.ingest(event.event_id));
        assert_eq!(activity.action, Action::Created);
        assert_eq!(activity.actor, expected_actor);
        assert_eq!(activity.subject_id, expected_subject);
    }
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
            editors: Vec::new(),
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
            editors: Vec::new(),
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

#[test]
fn human_sync_content_is_an_edit_by_the_authenticated_user() {
    let actor = user("macro|editor@example.com");
    let event = envelope(DocumentTopicEvent::SyncContentUpdated(
        DocumentSyncContentUpdatedMetadata {
            editors: Vec::new(),
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: None,
            actor: Some(Actor::new_from_user(actor.clone())),
            on_behalf_of: None,
        },
    ));
    let activity = single_activity(event.event.ingest(event.event_id));
    assert_eq!(activity.action, Action::Edited);
    assert_eq!(activity.actor.as_ref(), actor.as_ref());
    assert_eq!(activity.subject_id, actor.as_ref());
    assert_eq!(activity.entity_id, DOCUMENT_ID);
}

fn editor_event(editors: &[(&str, Option<&str>)]) -> DocumentTopicEvent {
    let mut metadata = DocumentSyncContentUpdatedMetadata::from_extract(
        DOCUMENT_ID.to_owned(),
        FileType::Md,
        None,
        None,
        None,
    );
    metadata.editors = editors
        .iter()
        .map(
            |(actor, subject)| crate::domain::events::DocumentSyncEditor {
                actor: Actor::try_from((*actor).to_owned()).unwrap(),
                on_behalf_of: subject.map(user),
            },
        )
        .collect();
    DocumentTopicEvent::SyncContentUpdated(metadata)
}

#[test]
fn batched_editors_are_distinct_and_keep_agent_attribution() {
    let event = editor_event(&[
        ("macro|alice@example.com", None),
        ("macro|alice@example.com", None),
        (
            "bot|00000000-0000-0000-0000-00000000a1a1",
            Some("macro|alice@example.com"),
        ),
        ("macro|bob@example.com", None),
    ]);
    let id = Uuid::now_v7();
    let Ingest::Insert(rows) = event.ingest(id) else {
        panic!("expected editors");
    };
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[0].actor.as_ref(),
        "bot|00000000-0000-0000-0000-00000000a1a1"
    );
    assert_eq!(rows[0].subject_id, "macro|alice@example.com");
    assert_eq!(rows[1].actor.as_ref(), "macro|alice@example.com");
    assert_eq!(rows[2].actor.as_ref(), "macro|bob@example.com");
    assert_eq!(event.ingest(id), Ingest::Insert(rows));
}

#[cfg(feature = "ports")]
struct Decisions(Vec<bool>);

#[cfg(feature = "ports")]
impl crate::domain::ports::EditingActivityStore for Decisions {
    async fn refresh_editing_sessions(
        &self,
        activities: &[Activity],
        _source_event_id: Uuid,
        idle: std::time::Duration,
    ) -> Result<Vec<bool>, rootcause::Report> {
        assert_eq!(idle, std::time::Duration::from_secs(300));
        assert_eq!(activities.len(), self.0.len());
        Ok(self.0.clone())
    }
}

#[cfg(feature = "ports")]
#[tokio::test]
async fn debounce_preserves_ordinals_and_ignores_empty_batches() {
    let event = editor_event(&[
        ("macro|alice@example.com", None),
        ("macro|bob@example.com", None),
    ]);
    let id = Uuid::now_v7();
    let row = single_activity(
        ingest_with_editing_sessions(&event, id, &Decisions(vec![false, true])).await,
    );
    assert_eq!(row.actor.as_ref(), "macro|bob@example.com");
    assert_eq!(row.id, activity_id(id, 1));
    assert_eq!(
        ingest_with_editing_sessions(&event, id, &Decisions(vec![false, false])).await,
        Ingest::Ignore
    );
    assert_eq!(
        ingest_with_editing_sessions(&editor_event(&[]), id, &Decisions(vec![true])).await,
        Ingest::Ignore
    );
}

#[cfg(feature = "ports")]
struct UnavailableStore {
    stalled: bool,
}

#[cfg(feature = "ports")]
impl crate::domain::ports::EditingActivityStore for UnavailableStore {
    async fn refresh_editing_sessions(
        &self,
        _activities: &[Activity],
        _source_event_id: Uuid,
        _idle: std::time::Duration,
    ) -> Result<Vec<bool>, rootcause::Report> {
        if self.stalled {
            std::future::pending::<()>().await;
        }
        Err(rootcause::report!("unavailable"))
    }
}

#[cfg(feature = "ports")]
#[tokio::test]
async fn unavailable_debounce_is_best_effort_and_does_not_stall_other_activity() {
    let event = editor_event(&[("macro|alice@example.com", None)]);
    let id = Uuid::now_v7();
    for stalled in [false, true] {
        let store = UnavailableStore { stalled };
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            ingest_with_editing_sessions(&event, id, &store),
        )
        .await
        .unwrap();
        assert_eq!(result, Ingest::Ignore);
        let deleted = DocumentTopicEvent::Deleted(DocumentDeletedMetadata {
            document_id: DOCUMENT_ID.to_owned(),
            actor_user_id: Some(user("macro|alice@example.com")),
            actor: None,
            on_behalf_of: None,
            project_id: None,
        });
        assert_eq!(
            ingest_with_editing_sessions(&deleted, id, &store).await,
            deleted.ingest(id)
        );
    }
}
