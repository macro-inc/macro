use super::*;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Default)]
struct State {
    pending: Vec<ImportEvent>,
    sent: Vec<ImportEvent>,
    marked: Vec<ImportEvent>,
    send_fails: bool,
    mark_fails: bool,
    reconciled: usize,
    active: bool,
    failed: bool,
    searches: Vec<SearchBackfill>,
    search_states: Vec<SearchState>,
}

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);

impl ExecutionRepo for Fake {
    async fn requester(
        &self,
        _: &ImportEvent,
    ) -> PortResult<Option<(TeamId, MacroUserIdStr<'static>)>> {
        unreachable!()
    }
    async fn claim(&self, _: &ImportEvent, _: WorkerId) -> PortResult<ClaimOutcome> {
        unreachable!()
    }
    async fn heartbeat(&self, _: &Lease) -> PortResult<Lease> {
        unreachable!()
    }
    async fn settle(
        &self,
        _: &Lease,
        _: ConversationStatus,
        _: Option<ImportError>,
    ) -> PortResult<()> {
        unreachable!()
    }
    async fn pending_events(&self, limit: u32) -> PortResult<Vec<ImportEvent>> {
        assert_eq!(limit, PAGE_SIZE);
        Ok(self.0.lock().unwrap().pending.clone())
    }
    async fn mark_published(&self, event: &ImportEvent) -> PortResult<()> {
        let mut state = self.0.lock().unwrap();
        assert!(
            state.sent.contains(event),
            "never acknowledge an unsent event"
        );
        if state.mark_fails {
            return Err(ImportError::Retryable.into());
        }
        state.marked.push(event.clone());
        state.pending.retain(|pending| pending != event);
        Ok(())
    }
    async fn dead_letter(&self, _: &ImportEvent) -> PortResult<WorkerOutcome> {
        let mut state = self.0.lock().unwrap();
        if state.active {
            return Ok(WorkerOutcome::Defer);
        }
        state.failed = true;
        Ok(WorkerOutcome::Acknowledge)
    }
    async fn reconcile(&self, limit: u32) -> PortResult<()> {
        assert_eq!(limit, PAGE_SIZE);
        self.0.lock().unwrap().reconciled += 1;
        Ok(())
    }
    async fn pending_search(&self, limit: u32) -> PortResult<Vec<SearchBackfill>> {
        assert_eq!(limit, PAGE_SIZE);
        Ok(self.0.lock().unwrap().searches.clone())
    }
    async fn record_search(&self, _: &SearchBackfill, state: SearchState) -> PortResult<()> {
        self.0.lock().unwrap().search_states.push(state);
        Ok(())
    }
}

impl ImportQueue for Fake {
    async fn publish(&self, event: &ImportEvent) -> PortResult<()> {
        let mut state = self.0.lock().unwrap();
        if state.send_fails {
            return Err(ImportError::Retryable.into());
        }
        state.sent.push(event.clone());
        Ok(())
    }
}

impl SearchBackfillClient for Fake {
    async fn submit(&self, _: &SearchBackfill) -> PortResult<Uuid> {
        Ok(Uuid::now_v7())
    }
    async fn progress(&self, _: Uuid) -> PortResult<SearchState> {
        Ok(SearchState::Completed)
    }
}

impl Clock for Fake {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

fn fixture() -> (Fake, ImportMaintenance<Fake, Fake, Fake, Fake>) {
    let fake = Fake::default();
    fake.0.lock().unwrap().pending.push(ImportEvent {
        job_id: Uuid::now_v7().try_into().unwrap(),
        slack_channel_id: "C123".parse().unwrap(),
        generation: 1,
    });
    let service = ImportMaintenance::new(fake.clone(), fake.clone(), fake.clone(), fake.clone());
    (fake, service)
}

#[tokio::test]
async fn outbox_send_then_ack_crash_republishes_without_losing_work() {
    let (fake, service) = fixture();
    fake.0.lock().unwrap().send_fails = true;
    assert!(service.publish().await.is_err());
    assert!(fake.0.lock().unwrap().marked.is_empty());
    fake.0.lock().unwrap().send_fails = false;
    fake.0.lock().unwrap().mark_fails = true;
    assert!(service.publish().await.is_err());
    assert_eq!(fake.0.lock().unwrap().pending.len(), 1);
    fake.0.lock().unwrap().mark_fails = false;
    service.publish().await.unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.sent.len(), 2);
    assert_eq!(state.sent[0], state.sent[1]);
    assert_eq!(state.marked.len(), 1);
    assert!(state.pending.is_empty());
}

#[tokio::test]
async fn dead_letter_defers_active_owner_then_acknowledges_durable_failure() {
    let (fake, service) = fixture();
    let event = fake.0.lock().unwrap().pending[0].clone();
    fake.0.lock().unwrap().active = true;
    assert_eq!(
        service.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Defer
    );
    assert!(!fake.0.lock().unwrap().failed);
    fake.0.lock().unwrap().active = false;
    assert_eq!(
        service.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert!(fake.0.lock().unwrap().failed);
}

#[tokio::test]
async fn recovery_reconciles_partial_search_without_publishing_new_imports() {
    let (fake, service) = fixture();
    let job_id = fake.0.lock().unwrap().pending[0].job_id;
    fake.0.lock().unwrap().searches.push(SearchBackfill {
        job_id,
        channel_ids: vec![Uuid::now_v7()],
        generation: 2,
        state: SearchState::Pending,
        updated_at: Utc::now(),
    });
    service.reconcile().await.unwrap();
    {
        let mut state = fake.0.lock().unwrap();
        assert_eq!(state.reconciled, 1);
        assert!(state.sent.is_empty());
        assert!(matches!(
            state.search_states[0],
            SearchState::Submitted { .. }
        ));
        state.searches[0].state = state.search_states[0].clone();
    }
    service.reconcile().await.unwrap();
    assert_eq!(
        fake.0.lock().unwrap().search_states[1],
        SearchState::Completed
    );
}
