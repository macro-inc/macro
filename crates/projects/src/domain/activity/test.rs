use ::activity::Action;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{ProjectDeletedMetadata, ProjectPermanentlyDeletedMetadata};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: ProjectTopicEvent) -> Event<ProjectTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

#[test]
fn attributed_delete_maps_and_unattributed_is_dropped() {
    let attributed = envelope(ProjectTopicEvent::Deleted(ProjectDeletedMetadata {
        project_id: "proj-1".to_string(),
        owner: user("macro|owner@example.com"),
        actor_user_id: Some(user("macro|teo@example.com")),
        parent_project_id: None,
        deleted_project_ids: vec!["proj-2".to_string()],
        deleted_document_ids: vec![],
        deleted_chat_ids: vec![],
    }));
    let Ingest::Insert(activities) = attributed.event.ingest(attributed.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].action, Action::Deleted);
    assert_eq!(activities[0].entity_id, "proj-1");

    let unattributed = envelope(ProjectTopicEvent::Deleted(ProjectDeletedMetadata {
        project_id: "proj-1".to_string(),
        owner: user("macro|owner@example.com"),
        actor_user_id: None,
        parent_project_id: None,
        deleted_project_ids: vec![],
        deleted_document_ids: vec![],
        deleted_chat_ids: vec![],
    }));
    assert_eq!(
        unattributed.event.ingest(unattributed.event_id),
        Ingest::Ignore
    );
}

#[test]
fn permanent_delete_purges_the_whole_cascade() {
    let event = envelope(ProjectTopicEvent::PermanentlyDeleted(
        ProjectPermanentlyDeletedMetadata {
            project_id: "proj-1".to_string(),
            owner: user("macro|owner@example.com"),
            actor_user_id: None,
            parent_project_id: None,
            purged_project_ids: vec!["proj-2".to_string()],
            purged_document_ids: vec!["doc-1".to_string()],
            purged_chat_ids: vec!["chat-1".to_string()],
        },
    ));

    assert_eq!(
        event.event.ingest(event.event_id),
        Ingest::Purge(vec![
            (EntityType::Project, "proj-1".to_string()),
            (EntityType::Project, "proj-2".to_string()),
            (EntityType::Document, "doc-1".to_string()),
            (EntityType::Chat, "chat-1".to_string()),
        ])
    );
}
