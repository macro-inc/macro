use super::*;
use crate::domain::models::push_notification_event::{
    RawPushNotificationEventMessage, SnsPushNotificationEvent,
};
use crate::domain::ports::PushNotificationEventQueue;
use crate::domain::service::PushNotificationEventHandler;
use rootcause::Report;
use std::sync::Mutex;

struct MockHandler {
    should_fail: bool,
}

impl PushNotificationEventHandler for MockHandler {
    async fn handle_event(&self, _event: &SnsPushNotificationEvent) -> Result<(), Report> {
        if self.should_fail {
            rootcause::bail!("mock handler failure");
        }
        Ok(())
    }
}

struct MockQueue {
    deleted_receipts: Mutex<Vec<String>>,
}

impl MockQueue {
    fn new() -> Self {
        Self {
            deleted_receipts: Mutex::new(Vec::new()),
        }
    }

    fn get_deleted_receipts(&self) -> Vec<String> {
        self.deleted_receipts.lock().unwrap().clone()
    }
}

impl PushNotificationEventQueue for MockQueue {
    async fn receive_messages(&self) -> Result<Vec<RawPushNotificationEventMessage>, Report> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.deleted_receipts
            .lock()
            .unwrap()
            .push(receipt_handle.to_string());
        Ok(())
    }
}

fn make_valid_message(receipt_handle: &str) -> RawPushNotificationEventMessage {
    let body = serde_json::json!({
        "EndpointArn": "arn:aws:sns:us-east-1:123:endpoint/APNS/app/device1",
        "EventType": "DeliveryFailure",
        "MessageId": "test-message-id"
    });
    RawPushNotificationEventMessage {
        body: Some(body.to_string()),
        receipt_handle: Some(receipt_handle.to_string()),
    }
}

#[tokio::test]
async fn test_deletes_queue_message_on_success() {
    let handler = MockHandler { should_fail: false };
    let queue = MockQueue::new();
    let worker = PushNotificationEventWorker::new(handler, queue);

    let messages = vec![make_valid_message("receipt-1")];
    worker.process_messages(&messages).await;

    assert_eq!(
        worker.queue.get_deleted_receipts(),
        vec!["receipt-1"],
        "should delete the queue message after successful handling"
    );
}

#[tokio::test]
async fn test_does_not_delete_queue_message_on_handler_error() {
    let handler = MockHandler { should_fail: true };
    let queue = MockQueue::new();
    let worker = PushNotificationEventWorker::new(handler, queue);

    let messages = vec![make_valid_message("receipt-1")];
    worker.process_messages(&messages).await;

    assert!(
        worker.queue.get_deleted_receipts().is_empty(),
        "should not delete the queue message when handling fails"
    );
}
