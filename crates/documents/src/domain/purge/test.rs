use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use model_owner::Owner;
use shared_entity_registry::{OwnedPurgeOutcome, PurgeOwnedEntity};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::{
    DocumentPurgeQueue, DocumentPurgeRepository, DocumentPurgeService, DocumentPurger,
    DocxPartReferences, PurgeTarget,
};
use crate::domain::models::DocumentError;

const OWNER: &str = "macro|owner@example.com";

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
    document: Mutex<Option<PurgeTarget>>,
    part_shas: Vec<String>,
    fail_rows: AtomicBool,
    fail_queue: AtomicBool,
    fail_release: AtomicBool,
    broker_failure: BrokerFailure,
}

impl Default for State {
    fn default() -> Self {
        Self {
            steps: Mutex::default(),
            document: Mutex::new(Some(PurgeTarget {
                owner: owner(),
                file_type: Some("pdf".to_owned()),
            })),
            part_shas: Vec::new(),
            fail_rows: AtomicBool::default(),
            fail_queue: AtomicBool::default(),
            fail_release: AtomicBool::default(),
            broker_failure: BrokerFailure::default(),
        }
    }
}

impl State {
    fn docx(part_shas: &[&str]) -> Self {
        Self {
            document: Mutex::new(Some(PurgeTarget {
                owner: owner(),
                file_type: Some("docx".to_owned()),
            })),
            part_shas: part_shas.iter().map(|sha| (*sha).to_owned()).collect(),
            ..Self::default()
        }
    }

    fn missing() -> Self {
        Self {
            document: Mutex::new(None),
            ..Self::default()
        }
    }

    fn record(&self, step: &'static str, detail: &str) {
        self.steps.lock().unwrap().push((step, detail.to_owned()));
    }

    fn steps(&self) -> Vec<(&'static str, String)> {
        self.steps.lock().unwrap().clone()
    }

    fn exists(&self) -> bool {
        self.document.lock().unwrap().is_some()
    }
}

fn owner() -> Owner {
    Owner::from_principal_str(OWNER).unwrap()
}

impl DocumentPurgeRepository for Arc<State> {
    async fn find(&self, document_id: &str) -> Result<Option<PurgeTarget>, DocumentError> {
        self.record("find", document_id);
        Ok(self.document.lock().unwrap().clone())
    }

    async fn docx_part_shas(&self, document_id: &str) -> Result<Vec<String>, DocumentError> {
        self.record("part_shas", document_id);
        Ok(self.part_shas.clone())
    }

    async fn purge_rows(&self, document_id: &str) -> Result<(), DocumentError> {
        self.record("rows", document_id);
        if self.fail_rows.load(Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "row deletion failed"
            )));
        }
        self.document.lock().unwrap().take();
        Ok(())
    }
}

impl DocumentPurgeQueue for Arc<State> {
    async fn enqueue(&self, document_id: String, owner: Owner) -> Result<(), DocumentError> {
        self.record("queue", &document_id);
        assert_eq!(owner.principal_id(), OWNER);
        if self.fail_queue.load(Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "queue unavailable"
            )));
        }
        Ok(())
    }
}

impl DocxPartReferences for Arc<State> {
    async fn release(&self, shas: Vec<String>) -> Result<(), DocumentError> {
        self.record("release", &shas.join(","));
        if self.fail_release.load(Ordering::SeqCst) {
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "sha counter unavailable"
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

fn purger(state: &Arc<State>) -> DocumentPurger<Arc<State>, Arc<State>, Arc<State>, Broker> {
    DocumentPurger::new(
        state.clone(),
        state.clone(),
        state.clone(),
        Broker(state.clone()),
    )
}

fn steps(id: Uuid, names: &[&'static str]) -> Vec<(&'static str, String)> {
    names.iter().map(|name| (*name, id.to_string())).collect()
}

#[tokio::test]
async fn purge_enqueues_and_publishes_before_deleting_the_rows() {
    let state = Arc::new(State::default());
    let id = Uuid::now_v7();
    purger(&state).purge(id).await.unwrap();
    assert_eq!(
        state.steps(),
        steps(id, &["find", "queue", "broker", "rows"])
    );
    assert!(!state.exists());
}

#[tokio::test]
async fn queue_failure_stops_before_the_event_and_the_rows() {
    let state = Arc::new(State {
        fail_queue: AtomicBool::new(true),
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), steps(id, &["find", "queue"]));
    assert!(state.exists());
}

#[tokio::test]
async fn broker_start_failure_keeps_the_rows() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::BeforeSpawn,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), steps(id, &["find", "queue", "broker"]));
    assert!(state.exists());
}

#[tokio::test]
async fn broker_delivery_failure_is_awaited_and_keeps_the_rows() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::DuringDelivery,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), steps(id, &["find", "queue", "broker"]));
    assert!(state.exists());
}

#[tokio::test]
async fn cancelled_broker_delivery_keeps_the_rows() {
    let state = Arc::new(State {
        broker_failure: BrokerFailure::Cancelled,
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge(id).await.is_err());
    assert_eq!(state.steps(), steps(id, &["find", "queue", "broker"]));
    assert!(state.exists());
}

#[tokio::test]
async fn row_failure_leaves_the_document_for_a_retry() {
    let state = Arc::new(State {
        fail_rows: AtomicBool::new(true),
        ..State::default()
    });
    let id = Uuid::now_v7();
    let service = purger(&state);
    assert!(service.purge(id).await.is_err());
    assert!(state.exists());

    state.fail_rows.store(false, Ordering::SeqCst);
    service.purge(id).await.unwrap();
    assert_eq!(
        state.steps(),
        steps(
            id,
            &[
                "find", "queue", "broker", "rows", "find", "queue", "broker", "rows"
            ]
        )
    );
    assert!(!state.exists());
}

#[tokio::test]
async fn docx_parts_are_released_after_the_rows_are_gone() {
    let state = Arc::new(State::docx(&["b", "a", "b"]));
    let id = Uuid::now_v7();
    purger(&state).purge(id).await.unwrap();
    let mut expected = steps(id, &["find", "part_shas", "queue", "broker", "rows"]);
    expected.push(("release", "b,a,b".to_owned()));
    assert_eq!(state.steps(), expected);
}

#[tokio::test]
async fn docx_parts_are_released_once_across_a_failed_attempt_and_its_retry() {
    let state = Arc::new(State {
        fail_rows: AtomicBool::new(true),
        ..State::docx(&["a"])
    });
    let id = Uuid::now_v7();
    let service = purger(&state);
    assert!(service.purge(id).await.is_err());
    state.fail_rows.store(false, Ordering::SeqCst);
    service.purge(id).await.unwrap();

    let mut expected = steps(
        id,
        &[
            "find",
            "part_shas",
            "queue",
            "broker",
            "rows",
            "find",
            "part_shas",
            "queue",
            "broker",
            "rows",
        ],
    );
    expected.push(("release", "a".to_owned()));
    assert_eq!(state.steps(), expected);
}

#[tokio::test]
async fn release_failure_after_the_rows_are_gone_still_purges() {
    let state = Arc::new(State {
        fail_release: AtomicBool::new(true),
        ..State::docx(&["a"])
    });
    let id = Uuid::now_v7();
    purger(&state).purge(id).await.unwrap();
    assert_eq!(state.steps().last(), Some(&("release", "a".to_owned())));
    assert!(!state.exists());
}

#[tokio::test]
async fn purge_of_a_missing_document_does_nothing() {
    let state = Arc::new(State::missing());
    let id = Uuid::now_v7();
    purger(&state).purge(id).await.unwrap();
    assert_eq!(state.steps(), steps(id, &["find"]));
}

#[tokio::test]
async fn purge_owned_of_a_missing_document_is_purged() {
    let state = Arc::new(State::missing());
    let id = Uuid::now_v7();
    assert_eq!(
        purger(&state).purge_owned(id, &owner()).await.unwrap(),
        OwnedPurgeOutcome::Purged
    );
    assert_eq!(state.steps(), steps(id, &["find"]));
}

#[tokio::test]
async fn purge_owned_refuses_a_document_owned_by_someone_else() {
    let state = Arc::new(State::default());
    let id = Uuid::now_v7();
    let team = Owner::Team(Uuid::from_u128(1));
    assert_eq!(
        purger(&state).purge_owned(id, &team).await.unwrap(),
        OwnedPurgeOutcome::OwnedElsewhere
    );
    assert_eq!(state.steps(), steps(id, &["find"]));
    assert!(state.exists());
}

#[tokio::test]
async fn purge_owned_of_the_expected_owner_purges() {
    let state = Arc::new(State::default());
    let id = Uuid::now_v7();
    assert_eq!(
        purger(&state).purge_owned(id, &owner()).await.unwrap(),
        OwnedPurgeOutcome::Purged
    );
    assert_eq!(
        state.steps(),
        steps(id, &["find", "queue", "broker", "rows"])
    );
    assert!(!state.exists());
}

#[tokio::test]
async fn purge_owned_returns_a_failed_purge_as_an_error() {
    let state = Arc::new(State {
        fail_queue: AtomicBool::new(true),
        ..State::default()
    });
    let id = Uuid::now_v7();
    assert!(purger(&state).purge_owned(id, &owner()).await.is_err());
    assert!(state.exists());
}
