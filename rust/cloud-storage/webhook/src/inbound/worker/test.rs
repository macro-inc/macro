use super::*;
use crate::domain::models::{NormalizedWebhookEvent, WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION};
use chrono::{DateTime, Utc};
use std::{
    collections::{HashSet, VecDeque},
    fmt,
    sync::{Arc, Mutex},
};
use tokio::time::Instant;

#[derive(Debug, Clone, Copy)]
struct TestError(&'static str);

impl fmt::Display for TestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for TestError {}

#[derive(Default)]
struct QueueState {
    receive_results: VecDeque<Result<Vec<RawWebhookEventQueueMessage>, TestError>>,
    receive_count: usize,
    delete_requests: Vec<String>,
    delay_requests: Vec<(String, Duration)>,
    failed_deletes: HashSet<String>,
    failed_delays: HashSet<String>,
    operations: Option<Arc<Mutex<Vec<String>>>>,
}

#[derive(Clone, Default)]
struct TestQueue {
    state: Arc<Mutex<QueueState>>,
}

impl TestQueue {
    fn with_receive_result(result: Result<Vec<RawWebhookEventQueueMessage>, TestError>) -> Self {
        let queue = Self::default();
        queue
            .state
            .lock()
            .expect("queue state lock")
            .receive_results
            .push_back(result);
        queue
    }

    fn fail_delete(&self, receipt_handle: &str) {
        self.state
            .lock()
            .expect("queue state lock")
            .failed_deletes
            .insert(receipt_handle.to_string());
    }

    fn fail_delay(&self, receipt_handle: &str) {
        self.state
            .lock()
            .expect("queue state lock")
            .failed_delays
            .insert(receipt_handle.to_string());
    }

    fn set_operations(&self, operations: Arc<Mutex<Vec<String>>>) {
        self.state.lock().expect("queue state lock").operations = Some(operations);
    }

    fn receive_count(&self) -> usize {
        self.state.lock().expect("queue state lock").receive_count
    }

    fn delete_requests(&self) -> Vec<String> {
        self.state
            .lock()
            .expect("queue state lock")
            .delete_requests
            .clone()
    }

    fn delay_requests(&self) -> Vec<(String, Duration)> {
        self.state
            .lock()
            .expect("queue state lock")
            .delay_requests
            .clone()
    }
}

impl WebhookEventQueue for TestQueue {
    type Err = TestError;

    async fn receive_messages(&self) -> Result<Vec<RawWebhookEventQueueMessage>, Self::Err> {
        let mut state = self.state.lock().expect("queue state lock");
        state.receive_count += 1;
        state.receive_results.pop_front().unwrap_or(Ok(Vec::new()))
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Self::Err> {
        let mut state = self.state.lock().expect("queue state lock");
        state.delete_requests.push(receipt_handle.to_string());
        if let Some(operations) = &state.operations {
            operations
                .lock()
                .expect("operations lock")
                .push(format!("delete:{receipt_handle}"));
        }
        if state.failed_deletes.contains(receipt_handle) {
            return Err(TestError("delete failed"));
        }
        Ok(())
    }

    async fn delay_message(&self, receipt_handle: &str, delay: Duration) -> Result<(), Self::Err> {
        let mut state = self.state.lock().expect("queue state lock");
        state
            .delay_requests
            .push((receipt_handle.to_string(), delay));
        if state.failed_delays.contains(receipt_handle) {
            return Err(TestError("visibility update failed"));
        }
        Ok(())
    }
}

struct ServiceState {
    outcomes: VecDeque<Result<WebhookWorkerDisposition, TestError>>,
    messages: Vec<WebhookEventQueueMessage>,
    operations: Option<Arc<Mutex<Vec<String>>>>,
}

#[derive(Clone)]
struct TestDeliveryService {
    state: Arc<Mutex<ServiceState>>,
}

impl TestDeliveryService {
    fn new(
        outcomes: impl IntoIterator<Item = Result<WebhookWorkerDisposition, TestError>>,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(ServiceState {
                outcomes: outcomes.into_iter().collect(),
                messages: Vec::new(),
                operations: None,
            })),
        }
    }

    fn set_operations(&self, operations: Arc<Mutex<Vec<String>>>) {
        self.state.lock().expect("service state lock").operations = Some(operations);
    }

    fn messages(&self) -> Vec<WebhookEventQueueMessage> {
        self.state
            .lock()
            .expect("service state lock")
            .messages
            .clone()
    }
}

impl WebhookEventDeliveryService for TestDeliveryService {
    type Err = TestError;

    async fn deliver_event(
        &self,
        message: WebhookEventQueueMessage,
    ) -> Result<WebhookWorkerDisposition, Self::Err> {
        let mut state = self.state.lock().expect("service state lock");
        if let Some(operations) = &state.operations {
            operations
                .lock()
                .expect("operations lock")
                .push(format!("service:{}", message.event.event_id));
        }
        state.messages.push(message);
        state
            .outcomes
            .pop_front()
            .expect("a delivery outcome for every valid test message")
    }
}

fn queue_message(event_id: &str) -> WebhookEventQueueMessage {
    WebhookEventQueueMessage::new(
        "wh_test".to_string(),
        NormalizedWebhookEvent {
            event_id: event_id.to_string(),
            schema_version: 1,
            event_name: "document.updated".to_string(),
            entity_type: "document".to_string(),
            entity_id: "doc_test".to_string(),
            ordering_key: "doc_test".to_string(),
            occurred_at: "2026-07-10T00:00:00Z"
                .parse::<DateTime<Utc>>()
                .expect("valid timestamp"),
            broker_envelope: serde_json::json!({"event_id": event_id}),
        },
    )
}

fn raw_message(
    message_id: &str,
    body: Option<String>,
    receipt_handle: Option<&str>,
) -> RawWebhookEventQueueMessage {
    RawWebhookEventQueueMessage {
        message_id: Some(message_id.to_string()),
        body,
        receipt_handle: receipt_handle.map(str::to_string),
    }
}

fn valid_raw_message(event_id: &str, receipt_handle: &str) -> RawWebhookEventQueueMessage {
    raw_message(
        event_id,
        Some(serde_json::to_string(&queue_message(event_id)).expect("serializable queue message")),
        Some(receipt_handle),
    )
}

#[tokio::test(start_paused = true)]
async fn empty_poll_sleeps_before_polling_again() {
    let queue = TestQueue::with_receive_result(Ok(Vec::new()));
    let worker = WebhookEventWorker::new(queue.clone(), TestDeliveryService::new([]));
    let started_at = Instant::now();

    worker.poll_and_process_batch().await;

    assert_eq!(Instant::now().duration_since(started_at), POLL_RETRY_DELAY);
    assert_eq!(queue.receive_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn failed_poll_sleeps_before_polling_again() {
    let queue = TestQueue::with_receive_result(Err(TestError("receive failed")));
    let worker = WebhookEventWorker::new(queue.clone(), TestDeliveryService::new([]));
    let started_at = Instant::now();

    worker.poll_and_process_batch().await;

    assert_eq!(Instant::now().duration_since(started_at), POLL_RETRY_DELAY);
    assert_eq!(queue.receive_count(), 1);
}

#[tokio::test]
async fn acknowledges_missing_malformed_and_unsupported_messages() {
    let mut unsupported = queue_message("unsupported");
    unsupported.version = WEBHOOK_EVENT_QUEUE_MESSAGE_VERSION + 1;
    let messages = vec![
        raw_message("missing", None, Some("receipt-missing")),
        raw_message(
            "malformed",
            Some("not valid json".to_string()),
            Some("receipt-malformed"),
        ),
        raw_message(
            "unsupported",
            Some(serde_json::to_string(&unsupported).expect("serializable queue message")),
            Some("receipt-unsupported"),
        ),
    ];
    let queue = TestQueue::with_receive_result(Ok(messages));
    let service = TestDeliveryService::new([]);
    let worker = WebhookEventWorker::new(queue.clone(), service.clone());

    worker.poll_and_process_batch().await;

    assert_eq!(
        queue.delete_requests(),
        [
            "receipt-missing",
            "receipt-malformed",
            "receipt-unsupported"
        ]
    );
    assert!(service.messages().is_empty());
}

#[tokio::test]
async fn deletes_valid_messages_after_acknowledge_disposition() {
    let message = queue_message("event-1");
    let queue = TestQueue::with_receive_result(Ok(vec![valid_raw_message(
        &message.event.event_id,
        "receipt-1",
    )]));
    let service = TestDeliveryService::new([Ok(WebhookWorkerDisposition::Acknowledge)]);
    let worker = WebhookEventWorker::new(queue.clone(), service.clone());

    worker.poll_and_process_batch().await;

    assert_eq!(service.messages(), [message]);
    assert_eq!(queue.delete_requests(), ["receipt-1"]);
    assert!(queue.delay_requests().is_empty());
}

#[tokio::test]
async fn changes_visibility_after_retry_disposition() {
    let delay = Duration::from_secs(30);
    let queue = TestQueue::with_receive_result(Ok(vec![valid_raw_message("event-1", "receipt-1")]));
    let service = TestDeliveryService::new([Ok(WebhookWorkerDisposition::RetryAfter(delay))]);
    let worker = WebhookEventWorker::new(queue.clone(), service);

    worker.poll_and_process_batch().await;

    assert_eq!(queue.delay_requests(), [("receipt-1".to_string(), delay)]);
    assert!(queue.delete_requests().is_empty());
}

#[tokio::test]
async fn failed_acknowledgment_leaves_the_message_for_redelivery() {
    let queue = TestQueue::with_receive_result(Ok(vec![valid_raw_message("event-1", "receipt-1")]));
    queue.fail_delete("receipt-1");
    let service = TestDeliveryService::new([Ok(WebhookWorkerDisposition::Acknowledge)]);
    let worker = WebhookEventWorker::new(queue.clone(), service);

    worker.poll_and_process_batch().await;

    assert_eq!(queue.delete_requests(), ["receipt-1"]);
    assert!(queue.delay_requests().is_empty());
}

#[tokio::test]
async fn failed_visibility_update_leaves_the_message_for_redelivery() {
    let delay = Duration::from_secs(60);
    let queue = TestQueue::with_receive_result(Ok(vec![valid_raw_message("event-1", "receipt-1")]));
    queue.fail_delay("receipt-1");
    let service = TestDeliveryService::new([Ok(WebhookWorkerDisposition::RetryAfter(delay))]);
    let worker = WebhookEventWorker::new(queue.clone(), service);

    worker.poll_and_process_batch().await;

    assert_eq!(queue.delay_requests(), [("receipt-1".to_string(), delay)]);
    assert!(queue.delete_requests().is_empty());
}

#[tokio::test]
async fn service_failures_do_not_acknowledge_or_stop_the_batch() {
    let queue = TestQueue::with_receive_result(Ok(vec![
        valid_raw_message("event-1", "receipt-1"),
        valid_raw_message("event-2", "receipt-2"),
    ]));
    let service = TestDeliveryService::new([
        Err(TestError("service failed")),
        Ok(WebhookWorkerDisposition::Acknowledge),
    ]);
    let worker = WebhookEventWorker::new(queue.clone(), service.clone());

    worker.poll_and_process_batch().await;

    assert_eq!(
        service
            .messages()
            .into_iter()
            .map(|message| message.event.event_id)
            .collect::<Vec<_>>(),
        ["event-1", "event-2"]
    );
    assert_eq!(queue.delete_requests(), ["receipt-2"]);
    assert!(queue.delay_requests().is_empty());
}

#[tokio::test]
async fn processes_each_batch_sequentially() {
    let operations = Arc::new(Mutex::new(Vec::new()));
    let queue = TestQueue::with_receive_result(Ok(vec![
        valid_raw_message("event-1", "receipt-1"),
        valid_raw_message("event-2", "receipt-2"),
    ]));
    queue.set_operations(operations.clone());
    let service = TestDeliveryService::new([
        Ok(WebhookWorkerDisposition::Acknowledge),
        Ok(WebhookWorkerDisposition::Acknowledge),
    ]);
    service.set_operations(operations.clone());
    let worker = WebhookEventWorker::new(queue, service);

    worker.poll_and_process_batch().await;

    assert_eq!(
        *operations.lock().expect("operations lock"),
        [
            "service:event-1",
            "delete:receipt-1",
            "service:event-2",
            "delete:receipt-2",
        ]
    );
}
