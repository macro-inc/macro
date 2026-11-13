use macro_event_broker::Event;
use serde_json::json;
use uuid::Uuid;

use super::*;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

#[test]
fn purged_wire_shape_carries_audience_routing() {
    let event = Event::with_event_id(
        Uuid::nil(),
        InitiativeTopicEvent::Purged {
            initiative_id: InitiativeId::from_uuid(Uuid::nil()),
            audience_user_ids: vec![user("macro|owner@example.com")],
        },
    );

    assert_eq!(
        serde_json::to_value(&event).expect("serializable"),
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "initiative.purged",
            "metadata": {
                "initiative_id": "00000000-0000-0000-0000-000000000000",
                "audience_user_ids": ["macro|owner@example.com"],
            },
        })
    );
}

#[test]
fn purged_published_before_audience_routing_decodes_empty() {
    let payload = json!({
        "event_id": "00000000-0000-0000-0000-000000000000",
        "schema_version": 1,
        "event_type": "initiative.purged",
        "metadata": { "initiative_id": "00000000-0000-0000-0000-000000000000" },
    });

    let event: Event<InitiativeTopicEvent> =
        serde_json::from_value(payload).expect("old payload decodes");

    assert_eq!(
        event.event,
        InitiativeTopicEvent::Purged {
            initiative_id: InitiativeId::from_uuid(Uuid::nil()),
            audience_user_ids: Vec::new(),
        }
    );
}
