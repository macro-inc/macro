use super::*;
use crate::domain::event_runs::{
    AuthorizedEventRun, ClaimToken, ConfigurationRevision, PendingEventRun,
};
use crate::domain::event_trigger::EventReference;
use crate::domain::models::ActionKind;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::{Uuid, generate_uuid_v7};
use model_entity::EntityType;
use model_owner::Owner;
use serde_json::json;
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

const USER: &str = "macro|runner@macro.com";

#[derive(Default)]
struct Repo {
    claim: Mutex<Option<ClaimToken>>,
    claims: AtomicUsize,
    releases: AtomicUsize,
    records: Mutex<Vec<ActionExecutionRecord>>,
    fail_persistence: bool,
}

impl ScheduledActionRepo for Repo {
    async fn claim_action(&self, _: &Uuid) -> Result<ClaimToken> {
        self.claims.fetch_add(1, Ordering::SeqCst);
        let mut claim = self.claim.lock().unwrap();
        anyhow::ensure!(claim.is_none(), "already running");
        let token = ClaimToken::generate();
        *claim = Some(token);
        Ok(token)
    }
    async fn release_action(&self, _: &Uuid, token: ClaimToken) -> Result<()> {
        let mut claim = self.claim.lock().unwrap();
        assert_eq!(*claim, Some(token));
        *claim = None;
        self.releases.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn create_execution_record(&self, record: ActionExecutionRecord) -> Result<()> {
        self.records.lock().unwrap().push(record);
        anyhow::ensure!(!self.fail_persistence, "persistence unavailable");
        Ok(())
    }
    async fn update_next_run_at(&self, _: &Uuid) -> Result<()> {
        Ok(())
    }
    async fn update_last_executed(&self, _: &Uuid, _: DateTime<Utc>) -> Result<()> {
        Ok(())
    }
    async fn create_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn get_actions(&self, _: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_action(
        &self,
        _: &Uuid,
        _: MacroUserIdStr<'static>,
    ) -> Result<Option<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_next_unclaimed_actions(&self, _: i64) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn update_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn delete_action(&self, _: &Uuid, _: MacroUserIdStr<'static>) -> Result<()> {
        unimplemented!()
    }
    async fn get_execution_records(&self, _: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        unimplemented!()
    }
}

#[derive(Default)]
struct Runner {
    preparations: AtomicUsize,
    calls: AtomicUsize,
    contexts: Mutex<Vec<Option<EventReference>>>,
    finish: CancellationToken,
    dropped: CancellationToken,
    fail_create: bool,
    fail_run: bool,
}
impl ScheduledAgentRunner for Runner {
    async fn create_chat(&self, _: &ScheduledAction) -> Result<String> {
        self.preparations.fetch_add(1, Ordering::SeqCst);
        anyhow::ensure!(!self.fail_create, "chat unavailable");
        Ok("run-chat".into())
    }
    async fn run(
        &self,
        _: &ScheduledAction,
        _: &str,
        event: Option<&EventReference>,
    ) -> Result<()> {
        let _guard = self.dropped.clone().drop_guard();
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.contexts.lock().unwrap().push(event.cloned());
        self.finish.cancelled().await;
        anyhow::ensure!(!self.fail_run, "agent stream failed");
        Ok(())
    }
}
#[derive(Default)]
struct Live(Mutex<Vec<ScheduledActionUpdate>>);
impl ScheduledActionLiveUpdate for Live {
    async fn publish_update(&self, update: ScheduledActionUpdate) {
        self.0.lock().unwrap().push(update);
    }
}

fn action() -> ScheduledAction {
    ScheduledAction {
        id: Some(generate_uuid_v7()),
        owner: Owner::User(MacroUserIdStr::parse_from_str(USER).unwrap()),
        name: "routine".into(),
        trigger: serde_json::from_value(
            json!({"type":"cron", "schedule":"0 0 * * * *", "timezone":"UTC"}),
        )
        .unwrap(),
        kind: ActionKind::Agent,
        task: json!({"model":"test", "prompt":"system", "user_prompt":"original"}),
        enabled: true,
        next_run_at: Some(Utc::now()),
        claimed: None,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}
fn executor(repo: Repo, runner: Runner) -> InProcessExecutor<Repo, Live, Runner> {
    InProcessExecutor::new(
        Arc::new(repo),
        Arc::new(runner),
        Arc::new(Live::default()),
        TaskTracker::new(),
        CancellationToken::new(),
    )
}
fn event_run() -> ClaimedEventRun {
    let mut action = action();
    action.trigger = serde_json::from_value(
        json!({"type":"events", "filters":[{"events":["document.updated"]}]}),
    )
    .unwrap();
    let entity = generate_uuid_v7();
    let event = serde_json::from_value(json!({
        "event_id":generate_uuid_v7(), "event_name":"document.updated", "entity_id":entity, "message_id":null,
    })).unwrap();
    let pending = PendingEventRun {
        action_id: action.id.unwrap(),
        revision: action.configuration_revision,
        event,
        admitted_at: Utc::now(),
    };
    ClaimedEventRun {
        run: AuthorizedEventRun {
            access: crate::domain::event_runs::EventAccessCapability::Document(
                EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                    MacroUserIdStr::parse_from_str(USER).unwrap(),
                    &entity.to_string(),
                    EntityType::Document,
                ),
            ),
            pending,
        },
        action,
        token: ClaimToken::generate(),
        started_at: Utc::now(),
        deadline: Utc::now() + MAX_ACTION_TIME,
    }
}
async fn drain(executor: &InProcessExecutor<Repo, Live, Runner>) {
    executor.tracker.close();
    tokio::time::timeout(Duration::from_secs(1), executor.tracker.wait())
        .await
        .unwrap();
}

#[tokio::test]
async fn manual_returns_chat_before_completion_and_tracks_one_run() {
    let executor = executor(Repo::default(), Runner::default());
    let progress = executor.execute_action(action()).await.unwrap();
    assert_eq!(progress.chat_id.as_deref(), Some("run-chat"));
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert!(executor.repo.records.lock().unwrap().is_empty());
    assert!(!executor.tracker.is_empty());
    executor.runner.finish.cancel();
    drain(&executor).await;
    let records = executor.repo.records.lock().unwrap();
    assert_eq!(records.len(), 1);
    assert!(records[0].is_success);
    assert_eq!(records[0].resource_id.as_deref(), Some("run-chat"));
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert_eq!(*executor.runner.contexts.lock().unwrap(), vec![None]);
}

#[tokio::test]
async fn manual_event_action_does_not_fabricate_event_context() {
    let executor = executor(Repo::default(), Runner::default());
    let mut action = event_run().action;
    action.enabled = false;
    executor.runner.finish.cancel();
    executor.execute_action(action).await.unwrap();
    drain(&executor).await;
    assert_eq!(*executor.runner.contexts.lock().unwrap(), vec![None]);
    assert_eq!(executor.repo.claims.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn manual_claim_failure_never_prepares_or_runs() {
    let executor = executor(Repo::default(), Runner::default());
    *executor.repo.claim.lock().unwrap() = Some(ClaimToken::generate());
    assert!(executor.execute_action(action()).await.is_err());
    drain(&executor).await;
    assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 0);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn non_user_owner_never_claims() {
    let executor = executor(Repo::default(), Runner::default());
    let mut action = action();
    action.owner = Owner::Team(generate_uuid_v7());
    assert!(executor.execute_action(action).await.is_err());
    assert_eq!(executor.repo.claims.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn chat_creation_failure_releases_its_claim() {
    let executor = executor(
        Repo::default(),
        Runner {
            fail_create: true,
            ..Runner::default()
        },
    );
    assert!(executor.execute_action(action()).await.is_err());
    drain(&executor).await;
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert!(!executor.repo.records.lock().unwrap()[0].is_success);
}

#[tokio::test]
async fn failed_execution_and_failed_bookkeeping_never_rerun_agent() {
    let executor = executor(
        Repo {
            fail_persistence: true,
            ..Repo::default()
        },
        Runner {
            fail_run: true,
            ..Runner::default()
        },
    );
    executor.runner.finish.cancel();
    executor.execute_action(action()).await.unwrap();
    drain(&executor).await;
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert!(!executor.repo.records.lock().unwrap()[0].is_success);
}

#[tokio::test]
async fn shutdown_cancels_tracked_run_and_releases_claim() {
    let executor = executor(Repo::default(), Runner::default());
    executor.execute_action(action()).await.unwrap();
    executor.cancellation.cancel();
    drain(&executor).await;
    assert!(executor.runner.dropped.is_cancelled());
    assert!(!executor.repo.records.lock().unwrap()[0].is_success);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn event_awaits_exactly_one_run_without_claiming_or_finalizing_twice() {
    let executor = executor(Repo::default(), Runner::default());
    executor.runner.finish.cancel();
    let run = event_run();
    let result = executor.execute(&run, std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Succeeded);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert_eq!(executor.repo.claims.load(Ordering::SeqCst), 0);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
    assert!(executor.repo.records.lock().unwrap().is_empty());
    assert_eq!(
        *executor.runner.contexts.lock().unwrap(),
        vec![Some(run.run.pending.event)]
    );
    let record = result.record.unwrap();
    assert_eq!(record.resource_id.as_deref(), Some("run-chat"));
    assert!(record.is_success);
}

#[tokio::test]
async fn event_chat_failure_returns_failed_bookkeeping_without_releasing_early() {
    let executor = executor(
        Repo::default(),
        Runner {
            fail_create: true,
            ..Runner::default()
        },
    );
    let result = executor.execute(&event_run(), std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    let record = result.record.unwrap();
    assert!(!record.is_success);
    assert!(record.resource_id.is_none());
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn dropping_event_execution_cancels_runner() {
    let executor = executor(Repo::default(), Runner::default());
    let run = event_run();
    let mut execution = Box::pin(executor.execute(&run, std::future::pending()));
    assert!(futures::poll!(&mut execution).is_pending());
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    drop(execution);
    assert!(executor.runner.dropped.is_cancelled());
}

#[tokio::test]
async fn expired_event_never_invokes_runner() {
    let executor = executor(Repo::default(), Runner::default());
    let mut run = event_run();
    run.deadline = Utc::now() - chrono::Duration::seconds(1);
    let result = executor.execute(&run, std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn event_deadline_drops_agent_and_returns_failure() {
    let executor = executor(Repo::default(), Runner::default());
    let mut run = event_run();
    run.deadline = Utc::now() + chrono::Duration::milliseconds(20);
    let result = executor.execute(&run, std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert!(executor.runner.dropped.is_cancelled());
    assert_eq!(
        result.record.unwrap().resource_id.as_deref(),
        Some("run-chat")
    );
}

#[tokio::test]
async fn event_cancellation_is_terminal_interruption() {
    let executor = executor(Repo::default(), Runner::default());
    let result = executor.execute(&event_run(), async {}).await;
    assert_eq!(result.outcome, EventRunOutcome::Interrupted);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
}
