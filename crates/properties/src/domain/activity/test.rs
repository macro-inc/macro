use ::activity::Action;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as ActivityEntityType;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::EntityPropertyUpdatedMetadata;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: PropertyTopicEvent) -> Event<PropertyTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

fn update(actor: Option<MacroUserIdStr<'static>>) -> EntityPropertyUpdatedMetadata {
    EntityPropertyUpdatedMetadata {
        entity_property_id: Uuid::from_u128(4),
        entity_id: "task-1".to_string(),
        entity_type: PropertyEntityType::Task,
        property_definition_id: Uuid::from_u128(3),
        actor_user_id: actor,
        value: None,
        updated_at: Utc::now(),
    }
}

#[test]
fn task_property_update_maps_to_property_changed_on_the_document() {
    let event = envelope(PropertyTopicEvent::EntityPropertyUpdated(update(Some(
        user("macro|seamus@example.com"),
    ))));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    // Tasks are documents in the soup vocabulary.
    assert_eq!(activities[0].entity_type, ActivityEntityType::Document);
    assert_eq!(activities[0].subject_id, "macro|seamus@example.com");
    match &activities[0].action {
        Action::PropertyChanged(change) => {
            assert_eq!(change.property, Uuid::from_u128(3).to_string());
            assert_eq!(change.from, None);
            // The event's value was None: cleared without deleting the row.
            assert_eq!(change.to, None);
        }
        other => panic!("expected property_changed, got {other:?}"),
    }
}

#[test]
fn unattributed_property_update_is_dropped() {
    let event = envelope(PropertyTopicEvent::EntityPropertyUpdated(update(None)));
    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}
