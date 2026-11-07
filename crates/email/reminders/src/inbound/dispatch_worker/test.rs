use std::sync::{Arc, Mutex};

use chrono::{DateTime, TimeZone, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::models::{DeliveryOutcome, ReminderError};

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn uuid(n: u8) -> Uuid {
    Uuid::from_bytes([n; 16])
}

fn message(body: &str) -> RawDispatchMessage {
    RawDispatchMessage {
        body: body.to_string(),
        receipt_handle: "receipt-1".to_string(),
    }
}

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeErr;

#[derive(Default)]
struct FakeServiceState {
    swept: usize,
    delivered: Vec<DueFiring>,
    sweep_fails: bool,
    deliver_fails: bool,
}

#[derive(Clone, Default)]
struct FakeService(Arc<Mutex<FakeServiceState>>);

impl FakeService {
    fn failing_sweep() -> Self {
        let service = Self::default();
        service.0.lock().unwrap().sweep_fails = true;
        service
    }

    fn failing_deliver() -> Self {
        let service = Self::default();
        service.0.lock().unwrap().deliver_fails = true;
        service
    }

    fn swept(&self) -> usize {
        self.0.lock().unwrap().swept
    }

    fn delivered(&self) -> Vec<DueFiring> {
        self.0.lock().unwrap().delivered.clone()
    }
}

impl ReminderDispatch for FakeService {
    async fn sweep(&self) -> Result<SweepSummary, ReminderError> {
        let mut state = self.0.lock().unwrap();
        if state.sweep_fails {
            return Err(ReminderError::NotFound);
        }
        state.swept += 1;
        Ok(SweepSummary { dispatched: 2 })
    }

    async fn deliver(&self, firing: DueFiring) -> Result<DeliveryOutcome, ReminderError> {
        let mut state = self.0.lock().unwrap();
        if state.deliver_fails {
            return Err(ReminderError::NotFound);
        }
        state.delivered.push(firing);
        Ok(DeliveryOutcome::Delivered)
    }
}

#[derive(Clone, Default)]
struct FakeQueue {
    deleted: Arc<Mutex<Vec<String>>>,
}

impl FakeQueue {
    fn deleted(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
    }
}

impl ReminderDispatchQueue for FakeQueue {
    type Err = FakeErr;

    async fn publish_batch(&self, _messages: &[ReminderDispatchMessage]) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn receive_messages(&self) -> Result<Vec<RawDispatchMessage>, Self::Err> {
        Ok(Vec::new())
    }

    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Self::Err> {
        self.deleted
            .lock()
            .unwrap()
            .push(receipt_handle.to_string());
        Ok(())
    }
}

fn worker(service: FakeService, queue: FakeQueue) -> DispatchWorker<FakeService, FakeQueue> {
    DispatchWorker::new(service, queue)
}

#[tokio::test]
async fn runs_a_sweep_for_the_eventbridge_payload() {
    // Verbatim what the EventBridge rule is configured to send.
    let service = FakeService::default();
    let queue = FakeQueue::default();

    worker(service.clone(), queue.clone())
        .handle_message(message(r#"{"operation":"sweep"}"#))
        .await;

    assert_eq!(service.swept(), 1);
    assert_eq!(queue.deleted(), vec!["receipt-1"]);
}

#[tokio::test]
async fn delivers_a_fanned_out_firing() {
    let service = FakeService::default();
    let queue = FakeQueue::default();

    let body = serde_json::to_string(&ReminderDispatchMessage::deliver(DueFiring {
        reminder_id: uuid(1),
        scheduled_for: now(),
    }))
    .expect("serializes");

    worker(service.clone(), queue.clone())
        .handle_message(message(&body))
        .await;

    assert_eq!(
        service.delivered(),
        vec![DueFiring {
            reminder_id: uuid(1),
            scheduled_for: now(),
        }]
    );
    assert_eq!(queue.deleted(), vec!["receipt-1"]);
}

#[tokio::test]
async fn discards_an_unparseable_message() {
    let service = FakeService::default();
    let queue = FakeQueue::default();

    worker(service.clone(), queue.clone())
        .handle_message(message("not json"))
        .await;

    assert_eq!(service.swept(), 0);
    assert!(service.delivered().is_empty());
    // Acked: no retry could ever parse it, and leaving it would burn a receive
    // a minute until the redrive policy dead-lettered it.
    assert_eq!(queue.deleted(), vec!["receipt-1"]);
}

#[tokio::test]
async fn discards_a_message_naming_an_unknown_operation() {
    let service = FakeService::default();
    let queue = FakeQueue::default();

    worker(service.clone(), queue.clone())
        .handle_message(message(r#"{"operation":"explode"}"#))
        .await;

    assert_eq!(service.swept(), 0);
    assert_eq!(queue.deleted(), vec!["receipt-1"]);
}

#[tokio::test]
async fn leaves_a_failed_sweep_for_redelivery() {
    let queue = FakeQueue::default();

    worker(FakeService::failing_sweep(), queue.clone())
        .handle_message(message(r#"{"operation":"sweep"}"#))
        .await;

    assert!(queue.deleted().is_empty());
}

#[tokio::test]
async fn leaves_a_failed_delivery_for_redelivery() {
    let queue = FakeQueue::default();

    let body = serde_json::to_string(&ReminderDispatchMessage::deliver(DueFiring {
        reminder_id: uuid(1),
        scheduled_for: now(),
    }))
    .expect("serializes");

    worker(FakeService::failing_deliver(), queue.clone())
        .handle_message(message(&body))
        .await;

    assert!(queue.deleted().is_empty());
}

#[tokio::test]
async fn stops_when_cancelled() {
    let token = CancellationToken::new();
    token.cancel();

    // Returns rather than hanging on the queue's long poll.
    worker(FakeService::default(), FakeQueue::default())
        .run(token)
        .await;
}
