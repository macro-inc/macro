use chrono::Utc;
use macro_event_broker::Event;
use serde_json::json;
use uuid::Uuid;

use super::*;

fn metadata() -> MentionMetadata {
    MentionMetadata {
        source: EntityRef {
            id: "doc-1".to_string(),
            kind: "doc".to_string(),
        },
        mentioned: EntityRef {
            id: "bot-1".to_string(),
            kind: "bot".to_string(),
        },
    }
}

#[test]
fn created_event_wire_shape() {
    let event = Event::with_event_id(Uuid::nil(), MentionTopicEvent::Created(metadata()));

    let value = serde_json::to_value(&event).expect("serializable");
    assert_eq!(
        value,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "mention.created",
            "metadata": {
                "source": { "id": "doc-1", "kind": "doc" },
                "mentioned": { "id": "bot-1", "kind": "bot" },
            },
        })
    );
}

#[test]
fn event_type_strings_follow_dot_convention() {
    assert_eq!(
        serde_json::to_value(MentionTopicEvent::Created(metadata())).unwrap()["event_type"],
        json!("mention.created")
    );
    assert_eq!(
        serde_json::to_value(MentionTopicEvent::Deleted(metadata())).unwrap()["event_type"],
        json!("mention.deleted")
    );
    assert_eq!(
        serde_json::to_value(MentionTopicEvent::MessageSent(metadata())).unwrap()["event_type"],
        json!("mention.message_sent")
    );
}

#[test]
fn events_are_keyed_by_mentioned_entity_id() {
    assert_eq!(MentionMacroEvent::created(metadata()).key(), "bot-1");
    assert_eq!(MentionMacroEvent::deleted(metadata()).key(), "bot-1");
    assert_eq!(MentionMacroEvent::message_sent(metadata()).key(), "bot-1");
}

#[test]
fn decode_round_trips() {
    let original = MentionMacroEvent::created(metadata());

    let payload = serde_json::to_vec(original.event()).expect("serializable");
    let decoded = MentionMacroEvent::decode(original.key(), &payload).expect("decodable payload");

    assert_eq!(decoded.key(), "bot-1");
    assert_eq!(decoded.event(), original.event());
}

#[test]
fn metadata_from_entity_mention_maps_fields() {
    let mention = EntityMention {
        id: Uuid::nil(),
        source_entity_type: "doc".to_string(),
        source_entity_id: "doc-1".to_string(),
        entity_type: "bot".to_string(),
        entity_id: "bot-1".to_string(),
        user_id: Some("macro|owner@example.com".to_string()),
        created_at: Utc::now(),
    };

    assert_eq!(MentionMetadata::from(&mention), metadata());
}
