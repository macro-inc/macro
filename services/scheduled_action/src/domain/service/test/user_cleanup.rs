use super::super::*;
use super::{configuration, user};
use crate::domain::event_runs::ClaimToken;
use std::sync::Mutex;

#[derive(Default)]
struct FakeRepo {
    actions: Mutex<Vec<ScheduledAction>>,
    fail_delete: Mutex<bool>,
}

impl ScheduledActionRepo for FakeRepo {
    async fn get_actions(&self, user: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        Ok(self
            .actions
            .lock()
            .unwrap()
            .iter()
            .filter(|a| a.owner.is_user(&user))
            .cloned()
            .collect())
    }
    async fn delete_action(&self, id: &Uuid, _: MacroUserIdStr<'static>) -> Result<()> {
        if *self.fail_delete.lock().unwrap() {
            bail!("injected deletion failure");
        }
        self.actions.lock().unwrap().retain(|a| a.id != Some(*id));
        Ok(())
    }
    async fn create_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unreachable!()
    }
    async fn get_action(
        &self,
        _: &Uuid,
        _: MacroUserIdStr<'static>,
    ) -> Result<Option<ScheduledAction>> {
        unreachable!()
    }
    async fn get_next_unclaimed_actions(&self, _: i64) -> Result<Vec<ScheduledAction>> {
        unreachable!()
    }
    async fn update_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unreachable!()
    }
    async fn claim_action(&self, _: &Uuid) -> Result<ClaimToken> {
        unreachable!()
    }
    async fn release_action(&self, _: &Uuid, _: ClaimToken) -> Result<()> {
        unreachable!()
    }
    async fn create_execution_record(&self, _: ActionExecutionRecord) -> Result<()> {
        unreachable!()
    }
    async fn get_execution_records(&self, _: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        unreachable!()
    }
    async fn update_next_run_at(&self, _: &Uuid) -> Result<()> {
        unreachable!()
    }
    async fn update_last_executed(&self, _: &Uuid, _: DateTime<Utc>) -> Result<()> {
        unreachable!()
    }
}

struct NeverExecutor;
impl ScheduledActionExecutor for NeverExecutor {
    async fn execute_action(&self, _: ScheduledAction) -> Result<InProgressExecution> {
        panic!("cleanup must not execute actions")
    }
}

fn action(owner: Owner, events: bool) -> ScheduledAction {
    let now = Utc::now();
    let config = configuration(events);
    ScheduledAction {
        id: Some(macro_uuid::generate_uuid_v7()),
        owner,
        name: config.name,
        next_run_at: next_run(&config.trigger).unwrap(),
        trigger: config.trigger,
        kind: config.kind,
        created_at: now,
        updated_at: now,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: events.then_some(now),
        task: config.task,
        claimed: None,
        enabled: true,
    }
}

#[tokio::test]
async fn deletes_disabled_and_claimed_actions_not_other_owners_and_retries_empty() {
    let repo = Arc::new(FakeRepo::default());
    let mut disabled = action(Owner::User(user()), false);
    disabled.enabled = false;
    let mut claimed = action(Owner::User(user()), false);
    claimed.claimed = Some(Utc::now());
    let event = action(Owner::User(user()), true);
    let other = action(
        Owner::User(MacroUserIdStr::try_from_email("other@example.com").unwrap()),
        false,
    );
    *repo.actions.lock().unwrap() = vec![
        disabled.clone(),
        claimed.clone(),
        event.clone(),
        other.clone(),
    ];
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    // Event management is disabled by default, but cleanup must still remove events.
    let service = ScheduledActionServiceImpl::new(repo.clone(), Arc::new(NeverExecutor), tx);

    service.delete_user_actions(user()).await.unwrap();
    service.delete_user_actions(user()).await.unwrap();
    let remaining = repo.actions.lock().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, other.id);
    for expected in [disabled.id, claimed.id, event.id] {
        assert!(matches!(rx.try_recv().unwrap(), DispatchEvent::Delete(a) if a.id == expected));
    }
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn repository_failure_keeps_retry_state_and_emits_no_delete() {
    let repo = Arc::new(FakeRepo::default());
    repo.actions
        .lock()
        .unwrap()
        .push(action(Owner::User(user()), false));
    *repo.fail_delete.lock().unwrap() = true;
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    let service = ScheduledActionServiceImpl::new(repo.clone(), Arc::new(NeverExecutor), tx);
    assert!(service.delete_user_actions(user()).await.is_err());
    assert_eq!(repo.actions.lock().unwrap().len(), 1);
    assert!(rx.try_recv().is_err());
    *repo.fail_delete.lock().unwrap() = false;
    service.delete_user_actions(user()).await.unwrap();
    assert!(repo.actions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn closed_dispatcher_fails_before_deleting_rows() {
    let repo = Arc::new(FakeRepo::default());
    repo.actions
        .lock()
        .unwrap()
        .push(action(Owner::User(user()), false));
    let (tx, rx) = tokio::sync::mpsc::channel(10);
    drop(rx);
    let service = ScheduledActionServiceImpl::new(repo.clone(), Arc::new(NeverExecutor), tx);
    assert!(service.delete_user_actions(user()).await.is_err());
    assert_eq!(repo.actions.lock().unwrap().len(), 1);
}
