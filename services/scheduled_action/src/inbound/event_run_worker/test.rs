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

const CONCURRENT_RUNS: u16 = 2;

#[derive(Clone)]
struct Service {
    state: Arc<State>,
    shutdown: CancellationToken,
    wait_for_shutdown: bool,
    slow_first: bool,
}
#[derive(Default)]
struct State {
    pending: Mutex<Vec<PendingEventRun>>,
    active: AtomicUsize,
    maximum: AtomicUsize,
    started: AtomicUsize,
    completed: AtomicUsize,
    maintenance: AtomicUsize,
    finishing: AtomicUsize,
    finish: tokio::sync::Notify,
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
        if self.wait_for_shutdown || (self.slow_first && call == 0) {
            cancellation.await;
            let finish = self.state.finish.notified();
            tokio::pin!(finish);
            finish.as_mut().enable();
            self.state.finishing.fetch_add(1, Ordering::SeqCst);
            finish.await;
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
        slow_first: false,
    }
}

#[tokio::test]
async fn bounded_dispatch_continues_after_failed_run() {
    let service = service(25, false);
    tokio::time::timeout(
        Duration::from_secs(2),
        run(
            service.clone(),
            service.shutdown.clone(),
            TaskTracker::new(),
            PageSize::try_from(CONCURRENT_RUNS).unwrap(),
            Duration::ZERO,
        ),
    )
    .await
    .unwrap();
    assert_eq!(service.state.completed.load(Ordering::SeqCst), 25);
    assert_eq!(
        service.state.maximum.load(Ordering::SeqCst),
        usize::from(CONCURRENT_RUNS)
    );
    assert!(service.state.maintenance.load(Ordering::SeqCst) >= 13);
    assert_eq!(service.state.active.load(Ordering::SeqCst), 0);
}

async fn wait_until(condition: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn slow_run_does_not_block_third_run_or_reconciliation() {
    let mut service = service(3, false);
    service.slow_first = true;
    let executions = TaskTracker::new();
    let worker = tokio::spawn(run(
        service.clone(),
        service.shutdown.clone(),
        executions.clone(),
        page_size(),
        Duration::from_millis(1),
    ));
    wait_until(|| service.state.completed.load(Ordering::SeqCst) == 2).await;
    assert_eq!(service.state.started.load(Ordering::SeqCst), 3);
    assert_eq!(service.state.active.load(Ordering::SeqCst), 1);
    assert_eq!(service.state.maximum.load(Ordering::SeqCst), 2);
    let maintenance = service.state.maintenance.load(Ordering::SeqCst);
    wait_until(|| service.state.maintenance.load(Ordering::SeqCst) > maintenance).await;
    service.shutdown.cancel();
    worker.await.unwrap();
    wait_until(|| service.state.finishing.load(Ordering::SeqCst) == 1).await;
    service.state.finish.notify_waiters();
    executions.close();
    tokio::time::timeout(Duration::from_secs(2), executions.wait())
        .await
        .unwrap();
    assert_eq!(service.state.completed.load(Ordering::SeqCst), 3);
}

fn page_size() -> PageSize {
    CONCURRENT_RUNS.try_into().unwrap()
}

#[tokio::test]
async fn cancelled_worker_does_not_poll_or_dispatch() {
    let service = service(3, false);
    service.shutdown.cancel();
    let executions = TaskTracker::new();
    run(
        service.clone(),
        service.shutdown.clone(),
        executions.clone(),
        page_size(),
        Duration::ZERO,
    )
    .await;
    assert_eq!(service.state.maintenance.load(Ordering::SeqCst), 0);
    assert_eq!(service.state.pending.lock().unwrap().len(), 3);
    assert!(executions.is_empty());
}

#[tokio::test]
async fn shutdown_signals_active_runs_and_awaits_completion_without_claiming_more() {
    let service = service(25, true);
    let executions = TaskTracker::new();
    let worker = tokio::spawn(run(
        service.clone(),
        service.shutdown.clone(),
        executions.clone(),
        PageSize::try_from(CONCURRENT_RUNS).unwrap(),
        Duration::ZERO,
    ));
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.state.started.load(Ordering::SeqCst) < usize::from(CONCURRENT_RUNS) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(executions.len(), usize::from(CONCURRENT_RUNS));
    let maintenance = service.state.maintenance.load(Ordering::SeqCst);
    wait_until(|| service.state.maintenance.load(Ordering::SeqCst) > maintenance).await;
    assert_eq!(service.state.pending.lock().unwrap().len(), 23);
    executions.close();
    service.shutdown.cancel();
    tokio::time::timeout(Duration::from_secs(2), worker)
        .await
        .unwrap()
        .unwrap();
    wait_until(|| service.state.finishing.load(Ordering::SeqCst) == 2).await;
    assert_eq!(executions.len(), 2);
    assert!(
        tokio::time::timeout(Duration::from_millis(10), executions.wait())
            .await
            .is_err()
    );
    service.state.finish.notify_waiters();
    tokio::time::timeout(Duration::from_secs(2), executions.wait())
        .await
        .unwrap();
    assert_eq!(
        service.state.completed.load(Ordering::SeqCst),
        usize::from(CONCURRENT_RUNS)
    );
    assert_eq!(service.state.active.load(Ordering::SeqCst), 0);
    assert_eq!(service.state.pending.lock().unwrap().len(), 23);
    assert!(executions.is_empty());
}
