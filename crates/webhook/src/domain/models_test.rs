#[cfg(feature = "ports")]
use super::models::{
    NormalizedWebhookEvent, WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION, WebhookEventQueueMessage,
};
use super::models::{WebhookFilter, WebhookFilters, WebhookScope};
#[cfg(feature = "ports")]
use chrono::{DateTime, Utc};
use serde_json::json;

#[test]
fn webhook_scope_strum_names_match_serde() {
    for scope in [WebhookScope::User, WebhookScope::Team] {
        let serde_name = serde_json::to_value(scope).unwrap();
        assert_eq!(serde_name, json!(scope.to_string()));
        assert_eq!(scope.to_string().parse::<WebhookScope>().unwrap(), scope);
    }
    assert!("workspace".parse::<WebhookScope>().is_err());
}

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

#[cfg(feature = "ports")]
#[test]
fn queue_message_json_round_trip_retains_normalized_event() {
    let broker_envelope = json!({
        "event_id": "019bbb3e-8d80-7000-8000-000000000001",
        "schema_version": 2,
        "event_type": "document.created",
        "metadata": {
            "document_id": "doc_123",
            "name": "Quarterly plan",
        },
    });
    let occurred_at = DateTime::parse_from_rfc3339("2026-07-10T15:30:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let message = WebhookEventQueueMessage::new(
        "wh_123".to_string(),
        NormalizedWebhookEvent {
            event_id: "019bbb3e-8d80-7000-8000-000000000001".to_string(),
            schema_version: 2,
            event_name: "document.created".to_string(),
            entity_type: "document".to_string(),
            entity_id: "doc_123".to_string(),
            ordering_key: "doc_123".to_string(),
            occurred_at,
            broker_envelope: broker_envelope.clone(),
        },
    );

    let serialized = serde_json::to_value(&message).unwrap();
    assert_eq!(
        serialized,
        json!({
            "version": WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION,
            "webhook_id": "wh_123",
            "event": {
                "event_id": "019bbb3e-8d80-7000-8000-000000000001",
                "schema_version": 2,
                "event_name": "document.created",
                "entity_type": "document",
                "entity_id": "doc_123",
                "ordering_key": "doc_123",
                "occurred_at": "2026-07-10T15:30:00Z",
                "broker_envelope": broker_envelope,
            },
        })
    );

    let round_trip: WebhookEventQueueMessage = serde_json::from_value(serialized).unwrap();
    assert_eq!(round_trip, message);
    assert!(round_trip.has_supported_version());
}

#[cfg(feature = "ports")]
#[test]
fn queue_message_rejects_delivery_configuration() {
    let result = serde_json::from_value::<WebhookEventQueueMessage>(json!({
        "version": WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION,
        "webhook_id": "wh_123",
        "endpoint_url": "https://example.com/webhook",
        "event": {
            "event_id": "evt_123",
            "schema_version": 1,
            "event_name": "document.created",
            "entity_type": "document",
            "entity_id": "doc_123",
            "ordering_key": "doc_123",
            "occurred_at": "2026-07-10T15:30:00Z",
            "broker_envelope": {},
        },
    }));

    assert!(result.is_err());
}
