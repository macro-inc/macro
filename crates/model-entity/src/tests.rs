use crate::EntityType;
use std::str::FromStr;

#[test]
fn it_should_build_entity_from_type() {
    let entity = EntityType::Document.with_entity_str("my_entity_id");
    assert_eq!(entity.entity_id, "my_entity_id");
    assert_eq!(entity.entity_type, EntityType::Document);
}

#[test]
fn scheduled_action_round_trips_as_snake_case() {
    let encoded = serde_json::to_string(&EntityType::ScheduledAction).unwrap();
    assert_eq!(encoded, "\"scheduled_action\"");
    assert_eq!(
        serde_json::from_str::<EntityType>(&encoded).unwrap(),
        EntityType::ScheduledAction
    );
    assert_eq!(EntityType::ScheduledAction.as_ref(), "scheduled_action");
    assert_eq!(
        EntityType::from_str("scheduled_action").unwrap(),
        EntityType::ScheduledAction
    );
}

#[test]
fn scheduled_action_is_not_an_entity_access_entity() {
    assert!(!EntityType::ScheduledAction.is_valid_entity_access_entity());
}
