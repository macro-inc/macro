use super::*;
use crate::domain::models::WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION;
use serde_json::json;

fn sample_message() -> WebhookEventQueueMessage {
    serde_json::from_value(json!({
        "version": WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION,
        "webhook_id": "wh_123",
        "event": {
            "event_id": "event_456",
            "schema_version": 1,
            "event_name": "document.created",
            "entity_type": "document",
            "entity_id": "doc_789",
            "ordering_key": "doc_789",
            "occurred_at": "2026-07-10T12:00:00Z",
            "broker_envelope": {
                "event_id": "event_456",
                "payload": { "document_id": "doc_789" }
            }
        }
    }))
    .unwrap()
}

#[test]
fn webhook_message_is_serialized_as_the_typed_queue_contract() {
    let message = sample_message();
    let prepared = prepare_webhook_message(&message).unwrap();
    let deserialized: WebhookEventQueueMessage = serde_json::from_str(&prepared.body).unwrap();

    assert_eq!(deserialized, message);
}

#[test]
fn webhook_message_uses_webhook_id_as_fifo_group_id() {
    let prepared = prepare_webhook_message(&sample_message()).unwrap();

    assert_eq!(prepared.group_id, "wh_123");
}

#[test]
fn webhook_message_combines_webhook_and_event_ids_for_fifo_deduplication() {
    let prepared = prepare_webhook_message(&sample_message()).unwrap();

    assert_eq!(prepared.deduplication_id, "wh_123:event_456");
}

#[test]
fn raw_webhook_message_retains_transport_fields() {
    let raw = raw_webhook_message(ReceivedMessage {
        message_id: Some("message-id".to_string()),
        body: Some("message-body".to_string()),
        receipt_handle: Some("receipt-handle".to_string()),
        receive_count: Some(3),
        string_attributes: HashMap::from([
            ("traceparent".to_owned(), "00-trace".to_owned()),
            ("tracestate".to_owned(), "vendor=1".to_owned()),
            ("unrelated".to_owned(), "kept out".to_owned()),
        ]),
    });

    assert_eq!(
        serde_json::Value::Object(raw.trace_context.clone()),
        json!({"traceparent": "00-trace", "tracestate": "vendor=1"})
    );
    assert_eq!(raw.message_id.as_deref(), Some("message-id"));
    assert_eq!(raw.body.as_deref(), Some("message-body"));
    assert_eq!(raw.receipt_handle.as_deref(), Some("receipt-handle"));
    assert_eq!(raw.receive_count, Some(3));
}

#[test]
fn visibility_timeout_rejects_values_above_the_sqs_limit() {
    assert_eq!(
        visibility_timeout_seconds(Duration::from_secs(43_200)).unwrap(),
        43_200,
    );
    assert_eq!(
        visibility_timeout_seconds(Duration::from_secs(43_201))
            .unwrap_err()
            .to_string(),
        "webhook message visibility delay cannot exceed 43200 seconds",
    );
}

#[test]
fn mcp_message_groups_by_subscription_and_dedupes_per_event() {
    let subscription = uuid::Uuid::now_v7();
    let message = McpEventQueueMessage::new(subscription, sample_message().event);
    let prepared = prepare_mcp_message(&message).unwrap();

    assert_eq!(prepared.group_id, format!("mcp:{subscription}"));
    assert_eq!(
        prepared.deduplication_id,
        format!("mcp:{subscription}:event_456")
    );
    assert!(prepared.deduplication_id.len() <= 128);
    let deserialized: McpEventQueueMessage = serde_json::from_str(&prepared.body).unwrap();
    assert_eq!(deserialized, message);
}
