//! Which events evict which entities, and the share-then-rename case
//! end to end through fan-out.

use super::*;
use crate::domain::models::WebhookScope;
use crate::domain::test_support::*;
use chat::domain::events::ChatUpdatedMetadata;
use documents::domain::events::{
    DocumentInteractionMetadata, DocumentMacroEvent, InteractionReason,
};
use macro_event_broker::{Event, MacroEvent};
use model_owner::Owner;
use projects::domain::events::ProjectUpdatedMetadata;
use serde_json::json;

const PROJECT: &str = "0193b3a0-0000-7000-8000-0000000000a1";
const CHAT: &str = "0193b3a0-0000-7000-8000-0000000000c4";
const DATABASE: &str = "0193b3a0-0000-7000-8000-0000000000db";
const FORM: &str = "0193b3a0-0000-7000-8000-0000000000f0";
const INITIATIVE: &str = "0193b3a0-0000-7000-8000-0000000000e1";

fn evicts(event: &LogMacroEvent, entity_type: EntityType, entity_id: &str) -> bool {
    invalidations(event).contains(&Invalidation::Entity {
        entity_type,
        entity_id: entity_id.to_owned(),
    })
}

fn wrap<M: MacroEvent>(event: M::EventPayload) -> M {
    M::from_event("key".to_owned(), Event::new(event))
}

fn project_renamed() -> LogMacroEvent {
    LogMacroEvent::ProjectMacroEvent(wrap(ProjectTopicEvent::Updated(ProjectUpdatedMetadata {
        project_id: PROJECT.to_owned(),
        owner: Owner::User(user("alice@example.com")),
        actor_user_id: Some(user("alice@example.com")),
        name: Some("renamed".to_owned()),
        previous_parent_id: None,
        parent_id: None,
        share_permission_updated: false,
    })))
}

#[test]
fn any_project_or_chat_update_evicts_it_even_without_a_share_flag() {
    let chat_renamed =
        LogMacroEvent::ChatMacroEvent(wrap(ChatTopicEvent::Updated(ChatUpdatedMetadata {
            chat_id: CHAT.to_owned(),
            actor_user_id: user("alice@example.com"),
            name: Some("renamed".to_owned()),
            previous_project_id: None,
            project_id: None,
            share_permission_updated: false,
        })));

    assert!(evicts(&project_renamed(), EntityType::Project, PROJECT));
    assert!(evicts(&chat_renamed, EntityType::Chat, CHAT));
}

#[test]
fn database_form_and_initiative_sharing_and_updates_evict_them() {
    let database: LogMacroEvent = LogMacroEvent::DatabaseMacroEvent(wrap(
        serde_json::from_value::<DatabaseTopicEvent>(json!({
            "event_type": "database.sharing_changed",
            "metadata": { "database_id": DATABASE }
        }))
        .unwrap(),
    ));
    let form: LogMacroEvent = LogMacroEvent::FormMacroEvent(wrap(
        serde_json::from_value::<FormTopicEvent>(json!({
            "event_type": "form.sharing_changed",
            "metadata": { "form_id": FORM }
        }))
        .unwrap(),
    ));
    let initiative: LogMacroEvent = LogMacroEvent::InitiativeMacroEvent(wrap(
        serde_json::from_value::<InitiativeTopicEvent>(json!({
            "event_type": "initiative.updated",
            "metadata": {
                "initiative_id": INITIATIVE,
                "occurred_at": "2026-11-13T00:00:00Z"
            }
        }))
        .unwrap(),
    ));

    assert!(evicts(&database, EntityType::Database, DATABASE));
    assert!(evicts(&form, EntityType::Form, FORM));
    assert!(evicts(&initiative, EntityType::Initiative, INITIATIVE));
}

#[test]
fn high_frequency_events_do_not_evict() {
    let interaction = LogMacroEvent::DocumentMacroEvent(wrap::<DocumentMacroEvent>(
        DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
            document_id: DOC.to_owned(),
            reason: InteractionReason::Edited,
        }),
    ));

    assert!(invalidations(&interaction).is_empty());
}

/// A project shared with a channel publishes nothing; the rename right after
/// evicts the project, so the new member receives it at once.
#[tokio::test(start_paused = true)]
async fn a_rename_after_a_silent_channel_share_reaches_the_new_member() {
    let harness = Harness::default();
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");
    harness.preview.enable(&bob);
    harness
        .access
        .grant(EntityType::Project, PROJECT, alice.as_ref());
    let mut bob_stream = harness
        .open(
            person(&bob),
            WebhookScope::User,
            filter(&["project.updated"]),
            None,
        )
        .await
        .unwrap();

    // Bob is checked (and cached) as a non-accessor.
    let first = log_record(&project_renamed()).unwrap().unwrap();
    harness.publish(first).await;
    assert_eq!(bob_stream.next_event_name().await, None);

    // The channel share grants bob access without any event.
    harness
        .access
        .grant(EntityType::Project, PROJECT, bob.as_ref());
    let rename = log_record(&project_renamed()).unwrap().unwrap();
    harness.publish(rename).await;

    assert_eq!(
        bob_stream.next_event_name().await.as_deref(),
        Some("project.updated")
    );
}
