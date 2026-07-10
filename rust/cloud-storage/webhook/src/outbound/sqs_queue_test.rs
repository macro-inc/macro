use super::*;
use crate::domain::models::WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION;
use aws_sdk_sqs::{
    Client, Config,
    config::{Credentials, Region},
};
use serde_json::json;

fn test_client() -> Client {
    let config = Config::builder()
        .behavior_version_latest()
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .region(Region::new("us-east-1"))
        .build();
    Client::from_conf(config)
}

fn test_queue(queue_url: &str, max_messages: i32, wait_time_seconds: i32) -> SqsWebhookQueue {
    SqsWebhookQueue::new(
        test_client(),
        queue_url.to_string(),
        max_messages,
        wait_time_seconds,
    )
}

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
fn webhook_queue_retains_its_configuration() {
    let queue = test_queue("webhook-event-queue.fifo", 10, 20);

    assert_eq!(queue.queue_url, "webhook-event-queue.fifo");
    assert_eq!(queue.max_messages, 10);
    assert_eq!(queue.wait_time_seconds, 20);
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
    let raw = raw_webhook_message(
        Message::builder()
            .message_id("message-id")
            .body("message-body")
            .receipt_handle("receipt-handle")
            .build(),
    );

    assert_eq!(raw.message_id.as_deref(), Some("message-id"));
    assert_eq!(raw.body.as_deref(), Some("message-body"));
    assert_eq!(raw.receipt_handle.as_deref(), Some("receipt-handle"));
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
