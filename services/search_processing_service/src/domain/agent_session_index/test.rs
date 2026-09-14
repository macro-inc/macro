use super::*;
use agent_session::domain::search::AgentSessionSearchMetadata;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

#[derive(Default)]
struct State {
    exists: AtomicBool,
    locked: AtomicBool,
    writes: Mutex<Vec<Option<Uuid>>>,
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
    async fn lock(&self, _: AgentSessionId) -> Result<Lease, Report> {
        assert!(!self.0.locked.swap(true, Ordering::SeqCst));
        Ok(Lease(self.0.clone()))
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
        Ok(if after.is_none() {
            vec![Uuid::from_u128(1)]
        } else {
            vec![]
        })
    }
}
impl AgentSessionSearchIndex for Index {
    async fn reconcile(&self, snapshot: SearchSnapshot, _: Option<&str>) -> Result<(), Report> {
        assert!(self.0.locked.load(Ordering::SeqCst));
        self.0
            .writes
            .lock()
            .unwrap()
            .push(Some(snapshot.metadata.id));
        Ok(())
    }
    async fn delete(&self, _: AgentSessionId, _: Option<&str>) -> Result<(), Report> {
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
    service.reconcile(id, None).await.unwrap();
    state.exists.store(false, Ordering::SeqCst);
    service.reconcile(id, None).await.unwrap();
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
            progress,
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(receipt.enqueued, 1);
    assert_eq!(state.writes.lock().unwrap().len(), 2);
}
