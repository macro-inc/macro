use super::*;
use aws_sdk_sqs::config::{BehaviorVersion, Credentials, Region, retry::RetryConfig};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use wiremock::matchers::{body_json, header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::domain::models::{Notification, SendNotificationRequestBuilder};

#[derive(serde::Serialize, serde::Deserialize)]
struct TestNotification;

impl Notification for TestNotification {
    const TYPE_NAME: &'static str = "test_notification";
}

fn valid_body() -> String {
    let request = SendNotificationRequestBuilder {
        notification_entity: model_entity::EntityType::Document.with_entity_str("doc_1"),
        secondary_notification_entity: None,
        notification: TestNotification,
        sender_id: None,
        recipient_ids: Default::default(),
    }
    .into_request()
    .with_conn_gateway();
    serde_json::to_string(&IngressQueueMessage::from_request(&request).unwrap()).unwrap()
}

async fn mock_queue(bodies: &[&str]) -> (MockServer, SqsQueue) {
    let server = MockServer::start().await;
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("us-east-1"))
        .credentials_provider(Credentials::new("test", "test", None, None, "test"))
        .endpoint_url(server.uri())
        .retry_config(RetryConfig::disabled())
        .build();
    let queue = SqsQueue::new(SqsClient::from_conf(config), server.uri());
    let messages: Vec<_> = bodies
        .iter()
        .enumerate()
        .map(|(index, body)| {
            json!({
                "MessageId": format!("message-{index}"),
                "ReceiptHandle": format!("receipt-{index}"),
                "Body": body,
            })
        })
        .collect();
    Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.ReceiveMessage"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "Messages": messages })))
        .expect(1)
        .mount(&server)
        .await;
    (server, queue)
}

async fn expect_delete(server: &MockServer, index: usize, status: u16) {
    Mock::given(method("POST"))
        .and(header("x-amz-target", "AmazonSQS.DeleteMessage"))
        .and(body_json(json!({
            "QueueUrl": server.uri(),
            "ReceiptHandle": format!("receipt-{index}"),
        })))
        .respond_with(ResponseTemplate::new(status).set_body_json(json!({})))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn ingress_acknowledges_malformed_messages_and_returns_ok() {
    let missing_request = json!({
        "message_type": "clear_push_notification",
        "content": { "Ios": {} },
    })
    .to_string();
    let (server, queue) = mock_queue(&[&missing_request, "not json"]).await;
    expect_delete(&server, 0, 200).await;
    expect_delete(&server, 1, 200).await;

    let messages = NotificationIngressQueue::receive_messages(&queue)
        .await
        .unwrap();

    assert!(messages.is_empty());
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
    server.verify().await;
}

#[tokio::test]
async fn ingress_keeps_valid_messages_in_a_mixed_batch_unacknowledged() {
    let valid = valid_body();
    let (server, queue) = mock_queue(&[&valid, "{}", &valid]).await;
    expect_delete(&server, 1, 200).await;

    let messages = NotificationIngressQueue::receive_messages(&queue)
        .await
        .unwrap();

    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].receipt_handle, "receipt-0");
    assert_eq!(messages[1].receipt_handle, "receipt-2");
    assert!(messages[0].body.request.send_conn_gateway);
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
    server.verify().await;
}

#[tokio::test]
async fn ingress_delete_failure_does_not_block_valid_messages() {
    let valid = valid_body();
    let (server, queue) = mock_queue(&["{}", &valid]).await;
    expect_delete(&server, 0, 500).await;

    let messages = NotificationIngressQueue::receive_messages(&queue)
        .await
        .unwrap();

    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].receipt_handle, "receipt-1");
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
    server.verify().await;
}

#[tokio::test(start_paused = true)]
async fn sends_in_parallel_with_bounded_concurrency() {
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let completed = AtomicUsize::new(0);
    let count = MAX_CONCURRENT_SENDS * 2 + 1;
    let delay = Duration::from_secs(1);
    let start = tokio::time::Instant::now();

    send_concurrently((0..count).map(|_| async {
        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
        peak.fetch_max(current, Ordering::SeqCst);
        tokio::time::sleep(delay).await;
        active.fetch_sub(1, Ordering::SeqCst);
        completed.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }))
    .await
    .unwrap();

    assert_eq!(peak.load(Ordering::SeqCst), MAX_CONCURRENT_SENDS);
    assert_eq!(completed.load(Ordering::SeqCst), count);
    assert_eq!(active.load(Ordering::SeqCst), 0);
    assert_eq!(start.elapsed(), delay * 3);
}

#[tokio::test(start_paused = true)]
async fn reports_send_failure_without_abandoning_other_sends() {
    let completed = AtomicUsize::new(0);
    let count = MAX_CONCURRENT_SENDS * 2;
    let result = send_concurrently((0..count).map(|index| {
        let completed = &completed;
        async move {
            if index == 0 {
                return Err(rootcause::report!("SQS send failed"));
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            completed.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }))
    .await;

    assert!(result.unwrap_err().to_string().contains("SQS send failed"));
    assert_eq!(completed.load(Ordering::SeqCst), count - 1);
}

#[tokio::test]
async fn empty_publish_succeeds_without_sending() {
    send_concurrently(std::iter::empty::<std::future::Ready<Result<(), Report>>>())
        .await
        .unwrap();
}
