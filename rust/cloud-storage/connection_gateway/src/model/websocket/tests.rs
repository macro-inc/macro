use cool_asserts::assert_matches;
use model_entity::{Entity, EntityType, TrackAction};
use serde_json::{Value, json};

use crate::model::websocket::{ToWebsocketMessage, TrackEntityMessage};

fn get_json() -> Value {
    json!({
        "type": "track_entity",
        "action": "open",
        "entity_id": "my_entity",
        "entity_type": "document"
    })
}

#[test]
fn it_deserializes() {
    let res: ToWebsocketMessage = serde_json::from_value(get_json()).unwrap();

    assert_matches!(res, ToWebsocketMessage::TrackEntityMessage(TrackEntityMessage { action: TrackAction::Open, extra: Entity { entity_type: EntityType::Document, entity_id, .. }}) => {
        assert_eq!(entity_id, "my_entity");
    })
}
#[test]
fn it_serializes() {
    let obj = ToWebsocketMessage::TrackEntityMessage(TrackEntityMessage {
        action: TrackAction::Open,
        extra: EntityType::Document.with_entity_str("my_entity"),
    });

    assert_eq!(serde_json::to_value(&obj).unwrap(), get_json());
}

#[test]
fn it_fails_on_invalid_entity_type() {
    let _err = serde_json::from_value::<ToWebsocketMessage>(json!({
        "type": "track_entity",
        "action": "open",
        "entity_id": "my_entity",
        "entity_type": "some garbage"
    }))
    .unwrap_err();
}

#[test]
fn it_fails_on_invalid_action_type() {
    let _err = serde_json::from_value::<ToWebsocketMessage>(json!({
        "type": "track_entity",
        "action": "some garbage",
        "entity_id": "my_entity",
        "entity_type": "document"
    }))
    .unwrap_err();
}
