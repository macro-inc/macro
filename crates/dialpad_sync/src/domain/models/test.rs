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
fn dialpad_s_field_shapes_decode() {
    let decoded = CallEvent::decode(event(json!({
        "date_started": "1746469000000",
        "date_connected": 1_746_469_010_000_i64,
        "date_ended": "1746469070000.0",
        "event_timestamp": " 1746469071000 ",
        "recap_action_items": [
            "Send a quote",
            {"content": "Book a demo"},
            {"content": null},
            null,
        ],
    })))
    .unwrap();
    assert_eq!(decoded.date_started, Some(1_746_469_000_000));
    assert_eq!(decoded.date_connected, Some(1_746_469_010_000));
    assert_eq!(decoded.date_ended, Some(1_746_469_070_000));
    assert_eq!(decoded.event_timestamp, Some(1_746_469_071_000));
    assert_eq!(
        decoded.recap_action_items.as_deref(),
        Some(&["Send a quote".to_owned(), "Book a demo".to_owned()][..])
    );

    let blank = CallEvent::decode(event(json!({"date_started": ""}))).unwrap();
    assert_eq!(blank.date_started, None, "a blank date is absent");
}

#[test]
fn an_unreadable_event_names_the_field_never_the_value() {
    for (fields, path) in [
        (json!({"date_started": "soon"}), "date_started"),
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
