use chrono::{TimeZone, Utc};
use serde_json::json;

use super::*;

#[test]
fn a_date_without_a_time_is_stored_in_its_old_form() {
    let stored = json!({"type": "Date", "value": "2026-11-24T08:00:00Z"});

    let value: PropertyValue = serde_json::from_value(stored.clone()).unwrap();

    assert_eq!(
        value,
        PropertyValue::Date(DateValue::new(
            Utc.with_ymd_and_hms(2026, 11, 24, 8, 0, 0).unwrap()
        ))
    );
    assert_eq!(serde_json::to_value(&value).unwrap(), stored);
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        r#"{"type":"Date","value":"2026-11-24T08:00:00Z"}"#
    );
}

#[test]
fn a_date_keeps_its_time_through_storage_and_the_api() {
    let stored = json!({"type": "Date", "value": "2026-11-24T21:00:00Z", "has_time": true});

    let value: PropertyValue = serde_json::from_value(stored.clone()).unwrap();
    let api: crate::api::PropertyValue = value.clone().into();
    let sent = serde_json::to_value(&api).unwrap();
    let back: PropertyValue = serde_json::from_value::<crate::api::PropertyValue>(sent.clone())
        .unwrap()
        .into();

    assert_eq!(
        value,
        PropertyValue::Date(DateValue::with_time(
            Utc.with_ymd_and_hms(2026, 11, 24, 21, 0, 0).unwrap()
        ))
    );
    assert_eq!(serde_json::to_value(&value).unwrap(), stored);
    assert_eq!(sent, stored);
    assert_eq!(back, value);
}

#[test]
fn other_values_are_stored_in_their_old_form() {
    for stored in [
        json!({"type": "Boolean", "value": true}),
        json!({"type": "Number", "value": 42.5}),
        json!({"type": "String", "value": "text"}),
        json!({"type": "DateRange", "value": {"start": "2026-11-23T00:00:00Z", "end": "2026-11-27T00:00:00Z"}}),
        json!({"type": "SelectOption", "value": ["00000001-0000-0000-0002-000000000001"]}),
        json!({"type": "EntityReference", "value": [{"entity_id": "doc", "entity_type": "DOCUMENT"}]}),
        json!({"type": "Link", "value": ["https://example.com"]}),
    ] {
        let value: PropertyValue = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(serde_json::to_value(&value).unwrap(), stored);
    }
}

#[test]
fn a_time_flag_on_anything_but_a_date_is_dropped() {
    let value: PropertyValue =
        serde_json::from_value(json!({"type": "Number", "value": 3.0, "has_time": true})).unwrap();

    assert_eq!(value, PropertyValue::Num(3.0));
    assert_eq!(
        serde_json::to_value(&value).unwrap(),
        json!({"type": "Number", "value": 3.0})
    );
}

#[test]
fn a_set_date_is_a_whole_day_unless_it_says_it_has_a_time() {
    let day: SetPropertyValue =
        serde_json::from_value(json!({"type": "date", "value": "2026-11-24T08:00:00Z"})).unwrap();
    let timed: SetPropertyValue = serde_json::from_value(
        json!({"type": "date", "value": "2026-11-24T21:00:00Z", "has_time": true}),
    )
    .unwrap();

    assert_eq!(
        convert_set_property_value_to_property_value(&day),
        PropertyValue::Date(DateValue::new(
            Utc.with_ymd_and_hms(2026, 11, 24, 8, 0, 0).unwrap()
        ))
    );
    assert_eq!(
        convert_set_property_value_to_property_value(&timed),
        PropertyValue::Date(DateValue::with_time(
            Utc.with_ymd_and_hms(2026, 11, 24, 21, 0, 0).unwrap()
        ))
    );
    assert_eq!(
        serde_json::to_value(&day).unwrap(),
        json!({"type": "date", "value": "2026-11-24T08:00:00Z"})
    );
}
