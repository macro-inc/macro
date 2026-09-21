use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::models::{Action, CommonAction, PropertyChange};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn activity(action: CommonAction) -> Activity {
    Activity::common(
        Uuid::from_u128(7),
        0,
        Actor::new_from_user(user("macro|teo@example.com")),
        None,
        EntityType::Document,
        "doc-1",
        action,
        Utc::now(),
    )
}

#[test]
fn wire_row_round_trips_into_a_record() {
    let activity = activity(CommonAction::Edited);
    let row = ActivityWireRow::from_activity(&activity);
    assert_eq!(row.id, activity.id);
    assert_eq!(row.subject_id, activity.subject_id);
    assert_eq!(row.action, "edited");
    assert_eq!(row.action_payload, None);

    let record = row.into_record().expect("well-formed row decodes");
    assert_eq!(record.id, activity.id);
    assert_eq!(record.actor, activity.actor);
    assert_eq!(record.entity_type, EntityType::Document);
    assert_eq!(record.action, RecordedAction::Known(Action::Edited));
}

#[test]
fn unknown_action_tags_survive_the_wire() {
    // A row written by a newer deployment: the tag is preserved raw rather
    // than dropped, mirroring reads from storage.
    let row = ActivityWireRow {
        id: Uuid::from_u128(1),
        actor_id: "macro|teo@example.com".to_string(),
        subject_id: "macro|teo@example.com".to_string(),
        entity_type: EntityType::Document,
        entity_id: "doc-1".to_string(),
        action: "transmogrified".to_string(),
        action_payload: Some(json!({ "thoroughly": true })),
        occurred_at: Utc::now(),
    };

    let record = row.into_record().expect("unknown tags still decode");
    assert_eq!(
        record.action,
        RecordedAction::Unknown {
            tag: "transmogrified".to_string(),
            payload: Some(json!({ "thoroughly": true })),
        }
    );
}

#[test]
fn corrupt_actor_rows_are_skipped() {
    let row = ActivityWireRow {
        id: Uuid::from_u128(2),
        actor_id: "not-a-principal".to_string(),
        subject_id: "macro|teo@example.com".to_string(),
        entity_type: EntityType::Document,
        entity_id: "doc-1".to_string(),
        action: "edited".to_string(),
        action_payload: None,
        occurred_at: Utc::now(),
    };

    assert_eq!(row.into_record(), None);
}

#[test]
fn payload_actions_carry_their_columns() {
    let source = Uuid::from_u128(9);
    let activity = Activity::common(
        source,
        1,
        Actor::new_from_user(user("macro|teo@example.com")),
        Some(user("macro|boss@example.com")),
        EntityType::Chat,
        "chat-1",
        CommonAction::PropertyChanged(PropertyChange {
            property: "prop-1".to_string(),
            from: Some(json!("Todo")),
            to: Some(json!("Done")),
        }),
        Utc::now(),
    );

    let row = ActivityWireRow::from_activity(&activity);
    assert_eq!(row.subject_id, "macro|boss@example.com");
    assert_eq!(row.action, "property_changed");
    assert_eq!(
        row.action_payload,
        Some(json!({ "property": "prop-1", "from": "Todo", "to": "Done" }))
    );

    let record = row.into_record().expect("decodes");
    assert_eq!(record.subject_id, "macro|boss@example.com");
}
