use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent};
use macro_event_topics::Topic;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::domain::models::WebhookFilter;

const WEBHOOK_ID: &str = "wh_01998a2f-aaaa-7bbb-8ccc-dddddddddddd";
const WORKSPACE_ID: &str = "team_0123";

fn user_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn filters() -> WebhookFilters {
    vec![
        WebhookFilter {
            events: vec!["document.updated".to_string()],
            ids: Some(vec!["document-123".to_string()]),
        },
        WebhookFilter {
            events: vec!["webhook.updated".to_string()],
            ids: None,
        },
    ]
}

#[test]
fn created_event_has_exact_sanitized_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f").expect("valid event id"),
        WebhookTopicEvent::Created(WebhookCreatedMetadata {
            webhook_id: WEBHOOK_ID.to_string(),
            workspace_id: WORKSPACE_ID.to_string(),
            created_by_user_id: user_id("macro|creator@example.com"),
            name: "Document updates".to_string(),
            endpoint_url: "https://example.com/hooks/macro".to_string(),
            status: WebhookStatus::Active,
            is_valid: false,
            filters: filters(),
            header_names: vec!["Authorization".to_string(), "X-Customer".to_string()],
            created_at: timestamp("2026-07-20T17:01:02Z"),
        }),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f",
            "schema_version": 1,
            "event_type": "webhook.created",
            "metadata": {
                "webhook_id": WEBHOOK_ID,
                "workspace_id": WORKSPACE_ID,
                "created_by_user_id": "macro|creator@example.com",
                "name": "Document updates",
                "endpoint_url": "https://example.com/hooks/macro",
                "status": "active",
                "is_valid": false,
                "filters": [
                    {
                        "events": ["document.updated"],
                        "ids": ["document-123"],
                    },
                    {
                        "events": ["webhook.updated"],
                    },
                ],
                "header_names": ["Authorization", "X-Customer"],
                "created_at": "2026-07-20T17:01:02Z",
            },
        })
    );
}

#[test]
fn updated_event_has_exact_sanitized_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-2b3c-7d4e-8f50-6b7c8d9e0f1a").expect("valid event id"),
        WebhookTopicEvent::Updated(WebhookUpdatedMetadata {
            webhook_id: WEBHOOK_ID.to_string(),
            workspace_id: WORKSPACE_ID.to_string(),
            actor_user_id: user_id("macro|editor@example.com"),
            name: None,
            endpoint_url: Some("https://example.com/hooks/updated".to_string()),
            filters: Some(filters()),
            headers_updated: true,
            status: Some(WebhookStatus::Paused),
            previous_status: Some(WebhookStatus::Active),
            is_valid: false,
            updated_at: timestamp("2026-07-20T17:03:11Z"),
        }),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-2b3c-7d4e-8f50-6b7c8d9e0f1a",
            "schema_version": 1,
            "event_type": "webhook.updated",
            "metadata": {
                "webhook_id": WEBHOOK_ID,
                "workspace_id": WORKSPACE_ID,
                "actor_user_id": "macro|editor@example.com",
                "name": null,
                "endpoint_url": "https://example.com/hooks/updated",
                "filters": [
                    {
                        "events": ["document.updated"],
                        "ids": ["document-123"],
                    },
                    {
                        "events": ["webhook.updated"],
                    },
                ],
                "headers_updated": true,
                "status": "paused",
                "previous_status": "active",
                "is_valid": false,
                "updated_at": "2026-07-20T17:03:11Z",
            },
        })
    );
}

#[test]
fn deleted_event_has_exact_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-3c4d-7e5f-8051-7c8d9e0f1a2b").expect("valid event id"),
        WebhookTopicEvent::Deleted(WebhookDeletedMetadata {
            webhook_id: WEBHOOK_ID.to_string(),
            workspace_id: WORKSPACE_ID.to_string(),
            actor_user_id: user_id("macro|deleter@example.com"),
        }),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-3c4d-7e5f-8051-7c8d9e0f1a2b",
            "schema_version": 1,
            "event_type": "webhook.deleted",
            "metadata": {
                "webhook_id": WEBHOOK_ID,
                "workspace_id": WORKSPACE_ID,
                "actor_user_id": "macro|deleter@example.com",
            },
        })
    );
}

#[test]
fn validated_event_has_exact_sanitized_wire_shape() {
    let event = Event::with_event_id(
        Uuid::parse_str("01998a30-4d5e-7f60-8152-8d9e0f1a2b3c").expect("valid event id"),
        WebhookTopicEvent::Validated(WebhookValidatedMetadata {
            webhook_id: WEBHOOK_ID.to_string(),
            workspace_id: WORKSPACE_ID.to_string(),
            actor_user_id: user_id("macro|validator@example.com"),
            is_valid: false,
            response_status: Some(401),
            message: Some("endpoint rejected validation request".to_string()),
        }),
    );

    assert_eq!(
        serde_json::to_value(event).expect("serializable event"),
        json!({
            "event_id": "01998a30-4d5e-7f60-8152-8d9e0f1a2b3c",
            "schema_version": 1,
            "event_type": "webhook.validated",
            "metadata": {
                "webhook_id": WEBHOOK_ID,
                "workspace_id": WORKSPACE_ID,
                "actor_user_id": "macro|validator@example.com",
                "is_valid": false,
                "response_status": 401,
                "message": "endpoint rejected validation request",
            },
        })
    );
}

#[test]
fn constructors_key_events_by_subject_webhook_id() {
    let cases = [
        WebhookMacroEvent::created(
            WEBHOOK_ID,
            WebhookCreatedMetadata {
                webhook_id: WEBHOOK_ID.to_string(),
                workspace_id: WORKSPACE_ID.to_string(),
                created_by_user_id: user_id("macro|creator@example.com"),
                name: "Lifecycle events".to_string(),
                endpoint_url: "https://example.com/hooks/macro".to_string(),
                status: WebhookStatus::Active,
                is_valid: false,
                filters: vec![],
                header_names: vec![],
                created_at: timestamp("2026-07-20T17:01:02Z"),
            },
        ),
        WebhookMacroEvent::updated(
            WEBHOOK_ID,
            WebhookUpdatedMetadata {
                webhook_id: WEBHOOK_ID.to_string(),
                workspace_id: WORKSPACE_ID.to_string(),
                actor_user_id: user_id("macro|editor@example.com"),
                name: None,
                endpoint_url: None,
                filters: None,
                headers_updated: false,
                status: None,
                previous_status: None,
                is_valid: true,
                updated_at: timestamp("2026-07-20T17:03:11Z"),
            },
        ),
        WebhookMacroEvent::deleted(
            WEBHOOK_ID,
            WebhookDeletedMetadata {
                webhook_id: WEBHOOK_ID.to_string(),
                workspace_id: WORKSPACE_ID.to_string(),
                actor_user_id: user_id("macro|deleter@example.com"),
            },
        ),
        WebhookMacroEvent::validated(
            WEBHOOK_ID,
            WebhookValidatedMetadata {
                webhook_id: WEBHOOK_ID.to_string(),
                workspace_id: WORKSPACE_ID.to_string(),
                actor_user_id: user_id("macro|validator@example.com"),
                is_valid: true,
                response_status: Some(204),
                message: None,
            },
        ),
    ];

    let expected_event_types = [
        "webhook.created",
        "webhook.updated",
        "webhook.deleted",
        "webhook.validated",
    ];

    for (event, expected_event_type) in cases.into_iter().zip(expected_event_types) {
        assert_eq!(event.key(), WEBHOOK_ID);
        assert_eq!(event.topic().as_str(), "macro.webhooks");
        assert_eq!(event.event().schema_version, 1);
        assert_eq!(
            serde_json::to_value(event.event()).expect("serializable event")["event_type"],
            expected_event_type
        );
    }
}

#[test]
fn macro_event_round_trips_without_exposing_secrets_or_header_values() {
    let original = WebhookMacroEvent::created(
        WEBHOOK_ID,
        WebhookCreatedMetadata {
            webhook_id: WEBHOOK_ID.to_string(),
            workspace_id: WORKSPACE_ID.to_string(),
            created_by_user_id: user_id("macro|creator@example.com"),
            name: "Lifecycle events".to_string(),
            endpoint_url: "https://example.com/hooks/macro".to_string(),
            status: WebhookStatus::Active,
            is_valid: false,
            filters: filters(),
            header_names: vec!["Authorization".to_string()],
            created_at: timestamp("2026-07-20T17:01:02Z"),
        },
    );
    let payload = serde_json::to_vec(original.event()).expect("serializable event");
    let serialized = String::from_utf8(payload.clone()).expect("JSON is UTF-8");

    assert!(!serialized.contains("signing_secret"));
    assert!(!serialized.contains("secret-value"));
    assert!(!serialized.contains("custom-header-value"));

    let decoded = WebhookMacroEvent::decode(original.key(), &payload).expect("decodable event");
    assert_eq!(decoded.key(), WEBHOOK_ID);
    assert_eq!(decoded.event(), original.event());
    assert_eq!(decoded.topic().as_str(), "macro.webhooks");
}
