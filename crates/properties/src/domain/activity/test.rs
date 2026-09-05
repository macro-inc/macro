use ::activity::{Action, Actor};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as ActivityEntityType;
use uuid::Uuid;

use macro_event_broker::Event;
use models_properties::service::property_value::PropertyValue;

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
        actor: None,
        on_behalf_of: None,
        value: None,
        previous_value: None,
        updated_at: Utc::now(),
    }
}

#[test]
fn property_update_carries_the_previous_value_as_the_transition_from() {
    let previous = PropertyValue::SelectOption(vec![Uuid::from_u128(7)]);
    let mut metadata = update(Some(user("macro|seamus@example.com")));
    metadata.previous_value = Some(previous.clone());
    let event = envelope(PropertyTopicEvent::EntityPropertyUpdated(metadata));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    match &activities[0].action {
        Action::PropertyChanged(change) => {
            assert_eq!(
                change.from,
                Some(serde_json::to_value(&previous).expect("serializable"))
            );
            assert_eq!(change.to, None);
        }
        other => panic!("expected property_changed, got {other:?}"),
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
    // Tasks are documents in the soup vocabulary. A user-only
    // `actor_user_id` (main's TaskPropertiesAdapter receipt) is Direct(user):
    // the feed renders "You" for that owner.
    assert_eq!(activities[0].entity_type, ActivityEntityType::Document);
    assert_eq!(activities[0].actor.as_ref(), "macro|seamus@example.com");
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

#[test]
fn delegated_property_update_keeps_the_user_as_subject() {
    let mut metadata = update(None);
    metadata.actor = Some(
        Actor::try_from("bot|00000000-0000-0000-0000-000000005759".to_string())
            .expect("system bot"),
    );
    metadata.on_behalf_of = Some(user("macro|owner@example.com"));
    let event = envelope(PropertyTopicEvent::EntityPropertyUpdated(metadata));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(
        activities[0].actor.as_ref(),
        "bot|00000000-0000-0000-0000-000000005759"
    );
    assert_eq!(activities[0].subject_id, "macro|owner@example.com");
}
