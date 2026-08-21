use activity::{Action, CallStart, PropertyChange, RecordedAction};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::*;

fn actor() -> activity::Actor<'static> {
    activity::Actor::new_from_user(
        MacroUserIdStr::try_from("macro|teo@example.com".to_string()).expect("valid user id"),
    )
}

fn record(action: RecordedAction) -> ActivityRecord {
    ActivityRecord {
        id: Uuid::from_u128(1),
        actor: actor(),
        subject_id: "macro|teo@example.com".to_string(),
        entity_type: activity::EntityType::Document,
        entity_id: "doc-1".to_string(),
        action,
        occurred_at: Utc::now(),
    }
}

#[test]
fn records_map_to_reference_fields() {
    let event = GraphqlActivityEvent::from(record(RecordedAction::Known(Action::Edited)));

    assert_eq!(event.id.as_str(), Uuid::from_u128(1).to_string());
    assert_eq!(event.actor_id, "macro|teo@example.com");
    assert_eq!(event.subject_id, "macro|teo@example.com");
    assert!(event.entity_type == GraphqlEntityType::Document);
    assert_eq!(event.entity_id.as_str(), "doc-1");
    assert!(matches!(event.action, GraphqlActivityAction::Edited(_)));
}

#[test]
fn payload_actions_carry_their_payload_fields() {
    let event = GraphqlActivityEvent::from(record(RecordedAction::Known(Action::PropertyChanged(
        PropertyChange {
            property: "prop-1".to_string(),
            from: None,
            to: Some(json!("Done")),
        },
    ))));
    match event.action {
        GraphqlActivityAction::PropertyChanged(change) => {
            assert_eq!(change.property, "prop-1");
            assert!(change.from.is_none());
            assert_eq!(change.to.map(|value| value.0), Some(json!("Done")));
        }
        other => panic!("expected PropertyChanged, got {}", type_name(&other)),
    }

    let event = GraphqlActivityEvent::from(record(RecordedAction::Known(Action::CallStarted(
        CallStart {
            call_id: "call-1".to_string(),
        },
    ))));
    match event.action {
        GraphqlActivityAction::CallStarted(start) => assert_eq!(start.call_id.as_str(), "call-1"),
        other => panic!("expected CallStarted, got {}", type_name(&other)),
    }
}

#[test]
fn unknown_actions_surface_their_raw_row() {
    let event = GraphqlActivityEvent::from(record(RecordedAction::Unknown {
        tag: "transmogrified".to_string(),
        payload: Some(json!({ "into": "a newt" })),
    }));
    match event.action {
        GraphqlActivityAction::Unknown(unknown) => {
            assert_eq!(unknown.tag, "transmogrified");
            assert_eq!(
                unknown.payload.map(|value| value.0),
                Some(json!({ "into": "a newt" }))
            );
        }
        other => panic!("expected Unknown, got {}", type_name(&other)),
    }
}

fn type_name(action: &GraphqlActivityAction) -> &'static str {
    match action {
        GraphqlActivityAction::Created(_) => "Created",
        GraphqlActivityAction::Edited(_) => "Edited",
        GraphqlActivityAction::Opened(_) => "Opened",
        GraphqlActivityAction::Deleted(_) => "Deleted",
        GraphqlActivityAction::Messaged(_) => "Messaged",
        GraphqlActivityAction::Sent(_) => "Sent",
        GraphqlActivityAction::PropertyChanged(_) => "PropertyChanged",
        GraphqlActivityAction::ParticipantAdded(_) => "ParticipantAdded",
        GraphqlActivityAction::ParticipantRemoved(_) => "ParticipantRemoved",
        GraphqlActivityAction::CallStarted(_) => "CallStarted",
        GraphqlActivityAction::Unknown(_) => "Unknown",
    }
}
