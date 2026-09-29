use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use model_owner::Owner;
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::{DocumentPurgeQueue, DocumentPurgeRepository, DocumentPurgeService, DocumentPurger};
use crate::domain::models::DocumentError;

#[derive(Clone, Copy, Default)]
enum BrokerFailure {
    #[default]
    None,
    BeforeSpawn,
    DuringDelivery,
    Cancelled,
}

struct State {
    steps: Mutex<Vec<(&'static str, String)>>,
    owner: Mutex<Option<Owner>>,
    fail_rows: AtomicBool,
    fail_queue: AtomicBool,
    broker_failure: BrokerFailure,
}

impl Default for State {
    fn default() -> Self {
        Self {
            steps: Mutex::default(),
            owner: Mutex::new(Some(
                Owner::from_principal_str("macro|owner@example.com").unwrap(),
            )),
            fail_rows: AtomicBool::default(),
            fail_queue: AtomicBool::default(),
            broker_failure: BrokerFailure::default(),
        }
    }
}

impl State {
    fn record(&self, step: &'static str, id: &str) {
        self.steps.lock().unwrap().push((step, id.to_owned()));
    }

    fn steps(&self) -> Vec<(&'static str, String)> {
        self.steps.lock().unwrap().clone()
    }
}

impl DocumentPurgeRepository for Arc<State> {
    async fn purge_rows(&self, document_id: &str) -> Result<Owner, DocumentError> {
        self.record("rows", document_id);
        if self.fail_rows.load(Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "row deletion failed"
            )));
        }
        self.owner
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| DocumentError::Internal(anyhow::anyhow!("document already removed")))
    }
}

impl DocumentPurgeQueue for Arc<State> {
    async fn enqueue(&self, document_id: String, owner: Owner) -> Result<(), DocumentError> {
        self.record("queue", &document_id);
        assert!(self.owner.lock().unwrap().is_none());
        assert_eq!(owner.principal_id(), "macro|owner@example.com");
        if self.fail_queue.load(Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "queue unavailable"
            )));
        }
        Ok(())
    }
}

struct Broker(Arc<State>);

impl MacroEventBroker for Broker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.0.record("broker", event.key());
        // Every retry uses the same document identity for queue and event consumers.
        let payload = serde_json::to_value(event.event())?;
        assert_eq!(payload["event_type"], "document.purged");
        assert_eq!(payload["metadata"]["document_id"], event.key());
        match self.0.broker_failure {
            BrokerFailure::BeforeSpawn => {
                Err(EventBrokerError::Publish("broker unavailable".into()))
            }
            BrokerFailure::DuringDelivery => Ok(tokio::spawn(async {
                Err(EventBrokerError::Publish("delivery failed".into()))
            })),
            BrokerFailure::Cancelled => {
                let delivery = tokio::spawn(std::future::pending());
                delivery.abort();
                Ok(delivery)
            }
            BrokerFailure::None => Ok(tokio::spawn(async { Ok(()) })),
        }
    }
}

fn purger(state: &Arc<State>) -> DocumentPurger<Arc<State>, Arc<State>, Broker> {
    DocumentPurger::new(state.clone(), state.clone(), Broker(state.clone()))
}

fn expected_steps(id: Uuid) -> Vec<(&'static str, String)> {
    ["rows", "queue", "broker"]
        .into_iter()
        .map(|step| (step, id.to_string()))
        .collect()
}

#[tokio::test]
async fn row_failure_does_not_publish_a_deletion_or_remove_stored_content() {
    let state = Arc::new(State {
        fail_rows: AtomicBool::new(true),
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), vec![("rows", id.to_string())]);
}

#[tokio::test]
async fn queue_failure_still_publishes_the_committed_deletion() {
    let state = Arc::new(State {
        fail_queue: AtomicBool::new(true),
        ..State::default()
    });
    let id = Uuid::now_v7();
    let service = purger(&state);
    assert!(service.purge(id).await.is_err());
    assert_eq!(state.steps(), expected_steps(id));
    assert!(state.owner.lock().unwrap().is_none());
}

#[tokio::test]
async fn broker_start_failure_preserves_the_content_cleanup_attempt() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::BeforeSpawn,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), expected_steps(id));
}

#[tokio::test]
async fn broker_delivery_failure_is_awaited_and_returned() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::DuringDelivery,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), expected_steps(id));
}

#[tokio::test]
async fn cancelled_broker_delivery_is_returned_after_content_cleanup() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::Cancelled,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), expected_steps(id));
}
