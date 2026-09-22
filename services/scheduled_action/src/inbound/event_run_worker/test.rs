use super::*;
use crate::domain::event_runs::{ConfigurationRevision, PendingEventRun, dispatch::DispatchResult};
use chrono::Utc;
use macro_uuid::generate_uuid_v7;
use rootcause::Report;
use serde_json::json;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

#[derive(Clone)]
struct Service {
    state: Arc<State>,
    shutdown: CancellationToken,
    wait_for_shutdown: bool,
}
#[derive(Default)]
struct State {
    pending: Mutex<Vec<PendingEventRun>>,
    active: AtomicUsize,
    maximum: AtomicUsize,
    started: AtomicUsize,
    completed: AtomicUsize,
    maintenance: AtomicUsize,
}
impl EventRunDispatch for Service {
    async fn pending(&self, limit: PageSize) -> Result<Vec<PendingEventRun>, Report> {
        let mut pending = self.state.pending.lock().unwrap();
        let count = pending.len().min(limit.get().into());
        Ok(pending.drain(..count).collect())
    }
    async fn reconcile(&self, limit: PageSize) -> Result<u16, Report> {
        assert_eq!(limit.get(), CONCURRENT_RUNS);
        self.state.maintenance.fetch_add(1, Ordering::SeqCst);
        Ok(0)
    }
    async fn dispatch(
        &self,
        _: PendingEventRun,
        cancellation: impl Future<Output = ()> + Send,
    ) -> Result<DispatchResult, Report> {
        let call = self.state.started.fetch_add(1, Ordering::SeqCst);
        let active = self.state.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.state.maximum.fetch_max(active, Ordering::SeqCst);
        if self.wait_for_shutdown {
            cancellation.await;
        } else {
            tokio::task::yield_now().await;
        }
        self.state.active.fetch_sub(1, Ordering::SeqCst);
        let completed = self.state.completed.fetch_add(1, Ordering::SeqCst) + 1;
        if completed == 25 {
            self.shutdown.cancel();
        }
        if call == 0 {
            return Err(rootcause::report!("first dispatch unavailable"));
        }
        Ok(DispatchResult::NotStarted)
    }
}
fn service(count: usize, wait_for_shutdown: bool) -> Service {
    let state = Arc::new(State::default());
    *state.pending.lock().unwrap() = (0..count).map(|_| PendingEventRun {
        action_id: generate_uuid_v7(), revision: ConfigurationRevision::INITIAL,
        event: serde_json::from_value(json!({"event_id":generate_uuid_v7(), "event_name":"document.updated", "entity_id":generate_uuid_v7(), "message_id":null})).unwrap(),
        admitted_at: Utc::now(),
    }).collect();
    Service {
        state,
        shutdown: CancellationToken::new(),
        wait_for_shutdown,
    }
}

#[tokio::test]
async fn bounded_batches_continue_after_failed_run() {
    let service = service(25, false);
    tokio::time::timeout(
        Duration::from_secs(2),
        run(service.clone(), service.shutdown.clone(), Duration::ZERO),
    )
    .await
    .unwrap();
    assert_eq!(service.state.completed.load(Ordering::SeqCst), 25);
    assert_eq!(
        service.state.maximum.load(Ordering::SeqCst),
        usize::from(CONCURRENT_RUNS)
    );
    assert_eq!(service.state.maintenance.load(Ordering::SeqCst), 3);
    assert_eq!(service.state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn shutdown_signals_active_runs_and_awaits_completion_without_claiming_more() {
    let service = service(25, true);
    let worker = tokio::spawn(run(
        service.clone(),
        service.shutdown.clone(),
        Duration::ZERO,
    ));
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.state.started.load(Ordering::SeqCst) < usize::from(CONCURRENT_RUNS) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.shutdown.cancel();
    tokio::time::timeout(Duration::from_secs(2), worker)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        service.state.completed.load(Ordering::SeqCst),
        usize::from(CONCURRENT_RUNS)
    );
    assert_eq!(service.state.active.load(Ordering::SeqCst), 0);
    assert_eq!(service.state.pending.lock().unwrap().len(), 15);
}
