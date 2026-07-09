use super::models::{WebhookFilter, WebhookFilters};
use serde_json::json;

#[test]
fn deserializes_filter_with_events_and_ids() {
    let filters: WebhookFilters =
        serde_json::from_value(json!([{ "events": ["document.created"], "ids": ["doc_1"] }]))
            .unwrap();

    assert_eq!(
        filters,
        vec![WebhookFilter {
            events: vec!["document.created".to_string()],
            ids: Some(vec!["doc_1".to_string()]),
        }]
    );
}

#[test]
fn deserializes_absent_ids_as_none() {
    let filters: WebhookFilters = serde_json::from_value(json!([{ "events": ["e"] }])).unwrap();

    assert_eq!(
        filters,
        vec![WebhookFilter {
            events: vec!["e".to_string()],
            ids: None,
        }]
    );
}

#[test]
fn deserializes_null_ids_as_none() {
    let filters: WebhookFilters =
        serde_json::from_value(json!([{ "events": ["e"], "ids": null }])).unwrap();

    assert_eq!(
        filters,
        vec![WebhookFilter {
            events: vec!["e".to_string()],
            ids: None,
        }]
    );
}

#[test]
fn serializes_none_ids_without_ids_key() {
    let filter = WebhookFilter {
        events: vec!["e".to_string()],
        ids: None,
    };

    let value = serde_json::to_value(filter).unwrap();

    assert_eq!(value, json!({ "events": ["e"] }));
    assert!(value.get("ids").is_none());
}

#[test]
fn rejects_unknown_filter_keys() {
    let result = serde_json::from_value::<WebhookFilters>(json!([{ "events": ["e"], "extra": 1 }]));

    assert!(result.is_err());
}

#[test]
fn rejects_non_string_array_entries() {
    for invalid_filters in [
        json!([{ "events": [1] }]),
        json!([{ "events": ["e"], "ids": [1] }]),
    ] {
        let result = serde_json::from_value::<WebhookFilters>(invalid_filters);

        assert!(result.is_err());
    }
}
