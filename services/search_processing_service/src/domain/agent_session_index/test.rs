use super::*;
use agent_session::domain::search::{AgentSessionSearchMetadata, indexing::GrantedLease};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

#[derive(Default)]
struct State {
    exists: AtomicBool,
    locked: AtomicBool,
    writes: Mutex<Vec<Option<Uuid>>>,
    /// Cancelled while the full scan reads its first page.
    cancel_on_page: Mutex<Option<CancellationToken>>,
}

struct Source(Arc<State>);
struct Index(Arc<State>);
struct Lease(Arc<State>);
impl Drop for Lease {
    fn drop(&mut self) {
        self.0.locked.store(false, Ordering::SeqCst);
    }
}

impl SearchSnapshotService for Source {
    type Lease = Lease;
    async fn lock(&self, _: AgentSessionId) -> Result<GrantedLease<Lease>, Report> {
        assert!(!self.0.locked.swap(true, Ordering::SeqCst));
        Ok(GrantedLease {
            lease: Lease(self.0.clone()),
            granted_at: chrono::Utc::now(),
        })
    }
    async fn snapshot(&self, id: AgentSessionId) -> Result<Option<SearchSnapshot>, Report> {
        assert!(self.0.locked.load(Ordering::SeqCst));
        Ok(self
            .0
            .exists
            .load(Ordering::SeqCst)
            .then(|| SearchSnapshot {
                metadata: AgentSessionSearchMetadata {
                    id: id.as_uuid(),
                    name: "searchable title".into(),
                    owner_id: macro_user_id::user_id::MacroUserIdStr::try_from(
                        "macro|test@example.com".to_string(),
                    )
                    .unwrap(),
                    bot_id: Uuid::from_u128(2),
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                },
                messages: vec![],
            }))
    }
    async fn page(&self, after: Option<Uuid>) -> Result<Vec<Uuid>, Report> {
        if let Some(cancel) = self.0.cancel_on_page.lock().unwrap().take() {
            cancel.cancel();
        }
        Ok(if after.is_none() {
            vec![Uuid::from_u128(1)]
        } else {
            vec![]
        })
    }
}
impl AgentSessionSearchIndex for Index {
    async fn reconcile(
        &self,
        snapshot: SearchSnapshot,
        _: Option<&str>,
        _: ProjectionVersion,
    ) -> Result<ProjectionWrites, Report> {
        assert!(self.0.locked.load(Ordering::SeqCst));
        self.0
            .writes
            .lock()
            .unwrap()
            .push(Some(snapshot.metadata.id));
        Ok(ProjectionWrites::default())
    }
    async fn delete(
        &self,
        _: AgentSessionId,
        _: Option<&str>,
        _: ProjectionVersion,
    ) -> Result<(), Report> {
        assert!(self.0.locked.load(Ordering::SeqCst));
        self.0.writes.lock().unwrap().push(None);
        Ok(())
    }
}

#[tokio::test]
async fn delayed_event_removes_deleted_session_and_holds_lease_through_index_write() {
    let state = Arc::new(State::default());
    let service = AgentSessionIndexService::new(Source(state.clone()), Index(state.clone()));
    let id = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    state.exists.store(true, Ordering::SeqCst);
    service
        .reconcile(id, None, ReconcileTrigger::Backfill)
        .await
        .unwrap();
    state.exists.store(false, Ordering::SeqCst);
    service
        .reconcile(id, None, ReconcileTrigger::Backfill)
        .await
        .unwrap();
    assert_eq!(
        *state.writes.lock().unwrap(),
        vec![Some(id.as_uuid()), None]
    );
    assert!(!state.locked.load(Ordering::SeqCst));
}

#[tokio::test]
async fn backfill_deduplicates_ids_and_full_scan_stops_at_end() {
    let state = Arc::new(State::default());
    state.exists.store(true, Ordering::SeqCst);
    let service = AgentSessionIndexService::new(Source(state.clone()), Index(state.clone()));
    let id = Uuid::from_u128(1);
    let progress = Arc::new(JobProgress::detached());
    let receipt = service
        .backfill(
            AgentSessionBackfillRequest {
                agent_session_ids: vec![id, id],
                index_override: None,
            },
            &crate::domain::backfill_gate::BackfillGate::open(1),
            progress.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(receipt.enqueued, 1);
    assert_eq!(progress.local_count(), 1);
    let receipt = service
        .backfill(
            AgentSessionBackfillRequest::default(),
            &crate::domain::backfill_gate::BackfillGate::open(1),
            progress,
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(receipt.enqueued, 1);
    assert_eq!(state.writes.lock().unwrap().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_paused_backfill_reconciles_nothing_and_stops_when_cancelled() {
    let state = Arc::new(State::default());
    state.exists.store(true, Ordering::SeqCst);
    let service = AgentSessionIndexService::new(Source(state.clone()), Index(state.clone()));
    let (_pause, paused) = tokio::sync::watch::channel(true);
    let gate = crate::domain::backfill_gate::BackfillGate::new(1, paused);
    let cancel = CancellationToken::new();
    let canceller = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        canceller.cancel();
    });

    let receipt = service
        .backfill(
            AgentSessionBackfillRequest {
                agent_session_ids: vec![Uuid::from_u128(1)],
                index_override: None,
            },
            &gate,
            Arc::new(JobProgress::detached()),
            cancel,
        )
        .await
        .unwrap();

    assert_eq!(receipt.enqueued, 0);
    assert!(state.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_full_scan_cancelled_while_reading_a_page_admits_nothing_with_a_free_unit() {
    for _ in 0..20 {
        let state = Arc::new(State::default());
        state.exists.store(true, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        *state.cancel_on_page.lock().unwrap() = Some(cancel.clone());
        let service = AgentSessionIndexService::new(Source(state.clone()), Index(state.clone()));

        let receipt = service
            .backfill(
                AgentSessionBackfillRequest::default(),
                &crate::domain::backfill_gate::BackfillGate::open(1),
                Arc::new(JobProgress::detached()),
                cancel,
            )
            .await
            .unwrap();

        assert_eq!(receipt.enqueued, 0);
        assert!(state.writes.lock().unwrap().is_empty());
    }
}
