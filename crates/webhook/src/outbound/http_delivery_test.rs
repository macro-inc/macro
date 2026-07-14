use super::*;
use crate::domain::{
    models::{WebhookFilter, WebhookStatus},
    ports::WebhookDeliveryClient,
};
use chrono::Utc;
use serde_json::json;
use std::collections::BTreeMap;

fn webhook(endpoint_url: &str, headers: WebhookHeaders) -> Webhook {
    Webhook {
        id: "wh_test".to_string(),
        workspace_id: "workspace_test".to_string(),
        name: "Test webhook".to_string(),
        endpoint_url: endpoint_url.to_string(),
        signing_secret: "signing-secret".to_string(),
        headers,
        status: WebhookStatus::Active,
        is_valid: true,
        created_by_user_id: "macro|test@example.com".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        deleted_at: None,
        filters: vec![WebhookFilter {
            events: vec!["document.created".to_string()],
            ids: None,
        }],
    }
}

fn event() -> NormalizedWebhookEvent {
    NormalizedWebhookEvent {
        event_id: "evt_test".to_string(),
        schema_version: 1,
        event_name: "document.created".to_string(),
        entity_type: "document".to_string(),
        entity_id: "doc_test".to_string(),
        ordering_key: "doc_test".to_string(),
        occurred_at: Utc::now(),
        broker_envelope: json!({
            "event_id": "evt_test",
            "schema_version": 1,
            "event_type": "document.created",
            "metadata": {"document_id": "doc_test"},
        }),
    }
}

fn outcome_details() -> WebhookHttpOutcomeDetails {
    WebhookHttpOutcomeDetails {
        duration: Duration::from_millis(10),
        response_status: None,
        response_headers_redacted: None,
        response_body_preview: None,
        error_kind: None,
        error_message: None,
    }
}

#[test]
fn builds_signed_request_with_exact_broker_envelope() {
    let webhook = webhook(
        "https://example.com/webhook",
        BTreeMap::from([("Authorization".to_string(), "Bearer secret".to_string())]),
    );
    let event = event();
    let raw_body = serde_json::to_vec(&event.broker_envelope).unwrap();
    let timestamp = "1783699200";
    let signature = signature_header(&webhook.signing_secret, timestamp, &raw_body).unwrap();
    let headers = delivery_headers(&webhook, &event, timestamp, &signature).unwrap();
    let request = delivery_request(
        &Client::new(),
        Url::parse(&webhook.endpoint_url).unwrap(),
        headers,
        raw_body.clone(),
    )
    .unwrap();

    assert_eq!(
        request.body().and_then(reqwest::Body::as_bytes),
        Some(raw_body.as_slice())
    );
    assert_eq!(request.headers()[CONTENT_TYPE], "application/json");
    assert_eq!(request.headers()[EVENT_HEADER], event.event_name);
    assert_eq!(request.headers()[EVENT_ID_HEADER], event.event_id);
    assert_eq!(request.headers()[TIMESTAMP_HEADER], timestamp);
    assert_eq!(request.headers()[SIGNATURE_HEADER], signature);
    assert_eq!(request.headers()["authorization"], "Bearer secret");
    assert!(request.headers()[SIGNATURE_HEADER].is_sensitive());
    assert!(request.headers()["authorization"].is_sensitive());
}

#[test]
fn rejects_reserved_headers_case_insensitively() {
    for name in [
        "X-Macro-Event",
        "x-macro-event-id",
        "X-MACRO-TIMESTAMP",
        "x-Macro-Signature",
    ] {
        let webhook = webhook(
            "https://example.com/webhook",
            BTreeMap::from([(name.to_string(), "override".to_string())]),
        );

        assert_eq!(
            delivery_headers(&webhook, &event(), "123", "v1=signature"),
            Err("reserved Macro headers cannot be overridden")
        );
    }
}

#[test]
fn rejects_invalid_custom_header_names_and_values() {
    let invalid_name = webhook(
        "https://example.com/webhook",
        BTreeMap::from([("bad header".to_string(), "value".to_string())]),
    );
    let invalid_value = webhook(
        "https://example.com/webhook",
        BTreeMap::from([("X-Custom".to_string(), "first\nsecond".to_string())]),
    );

    assert_eq!(
        delivery_headers(&invalid_name, &event(), "123", "v1=signature"),
        Err("custom webhook headers are invalid")
    );
    assert_eq!(
        delivery_headers(&invalid_value, &event(), "123", "v1=signature"),
        Err("custom webhook headers are invalid")
    );
}

#[test]
fn always_uses_json_content_type() {
    let webhook = webhook(
        "https://example.com/webhook",
        BTreeMap::from([("content-type".to_string(), "text/plain".to_string())]),
    );

    let headers = delivery_headers(&webhook, &event(), "123", "v1=signature").unwrap();

    assert_eq!(headers[CONTENT_TYPE], "application/json");
}

#[test]
fn classifies_http_response_statuses() {
    for status in [200, 201, 204, 299] {
        assert!(matches!(
            classify_http_status(StatusCode::from_u16(status).unwrap(), outcome_details()),
            WebhookHttpOutcome::Success(_)
        ));
    }

    for status in [408, 429, 500, 503, 599] {
        assert!(matches!(
            classify_http_status(StatusCode::from_u16(status).unwrap(), outcome_details()),
            WebhookHttpOutcome::RetryableFailure(_)
        ));
    }

    for status in [300, 400, 401, 404, 409, 422] {
        assert!(matches!(
            classify_http_status(StatusCode::from_u16(status).unwrap(), outcome_details()),
            WebhookHttpOutcome::PermanentFailure(_)
        ));
    }
}

#[test]
fn redacts_response_header_values() {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_static("private-request-id"),
    );

    assert_eq!(
        redacted_headers(&headers),
        BTreeMap::from([
            (
                "content-type".to_string(),
                REDACTED_HEADER_VALUE.to_string()
            ),
            (
                "x-request-id".to_string(),
                REDACTED_HEADER_VALUE.to_string()
            ),
        ])
    );
}

#[test]
fn caps_utf8_lossy_response_preview_at_4096_bytes() {
    let oversized = vec![b'a'; RESPONSE_PREVIEW_MAX_BYTES + 100];
    let invalid_utf8 = vec![0xff; RESPONSE_PREVIEW_MAX_BYTES];

    let preview = utf8_lossy_preview(&oversized);
    let lossy_preview = utf8_lossy_preview(&invalid_utf8);

    assert_eq!(preview.len(), RESPONSE_PREVIEW_MAX_BYTES);
    assert!(lossy_preview.contains('\u{fffd}'));
    assert!(lossy_preview.len() <= RESPONSE_PREVIEW_MAX_BYTES);
}

#[tokio::test]
async fn invalid_endpoint_configuration_is_permanent() {
    let client = ReqwestWebhookDeliveryClient::new().unwrap();
    let outcome = client
        .deliver(
            &webhook("http://example.com/webhook", BTreeMap::new()),
            &event(),
        )
        .await
        .unwrap();

    let WebhookHttpOutcome::PermanentFailure(details) = outcome else {
        panic!("invalid endpoint should be permanent");
    };
    assert_eq!(details.response_status, None);
    assert_eq!(
        details.error_kind.as_deref(),
        Some("endpoint_configuration")
    );
    assert_eq!(
        details.error_message.as_deref(),
        Some("webhook endpoint URL must use HTTPS")
    );
}

#[tokio::test]
async fn reserved_header_configuration_is_permanent_without_dns_lookup() {
    let client = ReqwestWebhookDeliveryClient::new().unwrap();
    let outcome = client
        .deliver(
            &webhook(
                "https://unresolvable.invalid/webhook",
                BTreeMap::from([("X-Macro-Signature".to_string(), "private".to_string())]),
            ),
            &event(),
        )
        .await
        .unwrap();

    let WebhookHttpOutcome::PermanentFailure(details) = outcome else {
        panic!("reserved header should be permanent");
    };
    assert_eq!(details.error_kind.as_deref(), Some("header_configuration"));
    assert_eq!(
        details.error_message.as_deref(),
        Some("reserved Macro headers cannot be overridden")
    );
}
