use super::*;
use serde_json::json;

fn event(fields: serde_json::Value) -> serde_json::Value {
    let mut event = json!({"call_id": 7, "state": "hangup"});
    if let serde_json::Value::Object(fields) = fields {
        event.as_object_mut().unwrap().extend(fields);
    }
    event
}

#[test]
fn dialpad_s_field_shapes_decode_and_store_in_one_shape() {
    let decoded = CallEvent::decode(event(json!({
        "direction": "sideways",
        "date_started": "1746469000000",
        "date_connected": 1_746_469_010_000_i64,
        "date_ended": "1746469070000.0",
        "event_timestamp": " 1746469071000 ",
        "contact": {"id": 4501, "name": "Jane Doe"},
        "recap_action_items": [
            "Send a quote",
            {"content": "Book a demo"},
            {"content": null},
            null,
        ],
    })))
    .unwrap();
    assert_eq!(decoded.direction, None, "an unknown direction is absent");
    assert_eq!(decoded.date_started, Some(1_746_469_000_000));
    assert_eq!(decoded.date_connected, Some(1_746_469_010_000));
    assert_eq!(decoded.date_ended, Some(1_746_469_070_000));
    assert_eq!(decoded.event_timestamp, Some(1_746_469_071_000));
    assert_eq!(
        decoded.contact.as_ref().unwrap().id.as_deref(),
        Some("4501")
    );
    assert_eq!(
        decoded.recap_action_items.as_deref(),
        Some(&["Send a quote".to_owned(), "Book a demo".to_owned()][..])
    );

    // What is stored is the declared shape, and it reads back the same.
    let stored = serde_json::to_value(&decoded).unwrap();
    assert_eq!(stored["date_started"], 1_746_469_000_000_i64);
    let reread = CallEvent::decode(stored).unwrap();
    assert_eq!(reread.date_ended, decoded.date_ended);
    assert_eq!(reread.recap_action_items, decoded.recap_action_items);

    let known = CallEvent::decode(event(json!({
        "direction": "Inbound",
        "date_started": "",
        "contact": {"id": "https://dialpad.com/contact/1"},
    })))
    .unwrap();
    assert_eq!(known.direction, Some(Direction::Inbound));
    assert_eq!(known.date_started, None, "a blank date is absent");
    assert_eq!(
        known.contact.unwrap().id.as_deref(),
        Some("https://dialpad.com/contact/1")
    );
}

#[test]
fn an_unreadable_event_names_the_field_never_the_value() {
    for (fields, path) in [
        (json!({"date_started": "soon"}), "date_started"),
        (json!({"contact": {"id": ["soon"]}}), "contact.id"),
        (
            json!({"recap_action_items": [{"content": ["soon"]}]}),
            "recap_action_items",
        ),
        (json!({"target": "soon"}), "target"),
    ] {
        let error = CallEvent::decode(event(fields)).unwrap_err();
        assert_eq!(error, path);
        assert!(!error.contains("soon"));
    }
}
