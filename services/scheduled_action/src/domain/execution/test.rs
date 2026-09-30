use super::*;
use crate::domain::event_runs::{
    AuthorizedEventRun, ClaimToken, ConfigurationRevision, PendingEventRun,
};
use crate::domain::event_trigger::EventReference;
use crate::domain::models::{ActionKind, ExecutionResourceType};
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

struct Admission {
    result: std::result::Result<(), AiAdmissionError>,
    calls: Mutex<Vec<(String, AiFeature)>>,
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        self.calls.lock().unwrap().push((user.to_string(), feature));
        Box::pin(async { self.result })
    }
}

fn admission(result: std::result::Result<(), AiAdmissionError>) -> Arc<Admission> {
    Arc::new(Admission {
        result,
        calls: Mutex::default(),
    })
}

struct StalledAdmission;

impl AiAdmissionService for StalledAdmission {
    fn admit<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
        _: AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        Box::pin(std::future::pending())
    }
}

#[tokio::test]
async fn shutdown_during_admission_releases_claim_without_contacting_runner() {
    let executor =
        executor(Repo::default(), Runner::default()).with_admission(Arc::new(StalledAdmission));
    let mut request = Box::pin(executor.execute_action(action()));
    assert!(futures::poll!(&mut request).is_pending());
    tokio::task::yield_now().await;
    assert!(executor.repo.claim.lock().unwrap().is_some());
    executor.cancellation.cancel();
    assert!(request.await.unwrap_err().is::<ExecutionCancelled>());
    drain(&executor).await;
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 0);
    assert!(executor.runner.cancellations.lock().unwrap().is_empty());
    assert!(executor.live_updates.0.lock().unwrap().is_empty());
}

fn admission_failures() -> [AiAdmissionError; 2] {
    [
        AiAdmissionError::Denied(ai_billing::DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ]
}

#[tokio::test]
async fn manual_and_cron_refusals_release_claims_and_advance_schedule_without_resources() {
    for error in admission_failures() {
        // Both the manual service and cron dispatchers use execute_action.
        let admission = admission(Err(error));
        let executor =
            executor(Repo::default(), Runner::default()).with_admission(admission.clone());
        let returned = executor.execute_action(action()).await.unwrap_err();
        assert_eq!(returned.downcast_ref::<AiAdmissionError>(), Some(&error));
        drain(&executor).await;
        assert_eq!(
            *admission.calls.lock().unwrap(),
            [(USER.into(), AiFeature::Automation)]
        );
        assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 0);
        assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
        assert!(executor.runner.cancellations.lock().unwrap().is_empty());
        assert!(executor.live_updates.0.lock().unwrap().is_empty());
        assert_eq!(executor.repo.claims.load(Ordering::SeqCst), 1);
        assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
        assert_eq!(executor.repo.rescheduled.load(Ordering::SeqCst), 1);
        assert!(executor.repo.claim.lock().unwrap().is_none());
        let records = executor.repo.records.lock().unwrap();
        assert_eq!(records.len(), 1);
        assert!(!records[0].is_success);
        assert!(records[0].resource_id.is_none());
        assert_eq!(records[0].result["error"], error.to_string());
    }
}

#[tokio::test]
async fn event_refusals_return_terminal_bookkeeping_without_replaying_or_releasing_early() {
    for error in admission_failures() {
        let admission = admission(Err(error));
        let executor =
            executor(Repo::default(), Runner::default()).with_admission(admission.clone());
        let result = executor.execute(&event_run(), std::future::pending()).await;
        assert_eq!(result.outcome, EventRunOutcome::Failed);
        let record = result.record.unwrap();
        assert!(!record.is_success);
        assert!(record.resource_id.is_none());
        assert_eq!(record.result["error"], error.to_string());
        assert_eq!(
            *admission.calls.lock().unwrap(),
            [(USER.into(), AiFeature::Automation)]
        );
        assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 0);
        assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
        assert!(executor.live_updates.0.lock().unwrap().is_empty());
        assert!(executor.runner.cancellations.lock().unwrap().is_empty());
        // The event worker finalizes this failure and releases run.token atomically.
        assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
        assert!(executor.repo.records.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn admitted_model_execution_uses_the_persisted_owner_and_automation_feature() {
    let admission = admission(Ok(()));
    let executor = executor(Repo::default(), Runner::default()).with_admission(admission.clone());
    executor.runner.finish.cancel();
    executor.execute_action(action()).await.unwrap();
    drain(&executor).await;
    assert_eq!(
        *admission.calls.lock().unwrap(),
        [(USER.into(), AiFeature::Automation)]
    );
    assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 1);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert!(executor.repo.records.lock().unwrap()[0].is_success);
}

#[derive(Default)]
struct Repo {
    claim: Mutex<Option<ClaimToken>>,
    claims: AtomicUsize,
    claimed_revisions: Mutex<Vec<i64>>,
    releases: AtomicUsize,
    rescheduled: AtomicUsize,
    records: Mutex<Vec<ActionExecutionRecord>>,
    fail_persistence: bool,
    stall_persistence: bool,
}

impl ScheduledActionRepo for Repo {
    async fn claim_action(&self, _: &Uuid, revision: ConfigurationRevision) -> Result<ClaimToken> {
        self.claims.fetch_add(1, Ordering::SeqCst);
        self.claimed_revisions.lock().unwrap().push(revision.get());
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
        if self.stall_persistence {
            std::future::pending::<()>().await;
        }
        anyhow::ensure!(!self.fail_persistence, "persistence unavailable");
        Ok(())
    }
    async fn update_next_run_at(&self, _: &Uuid) -> Result<()> {
        self.rescheduled.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn update_last_executed(&self, _: &Uuid, _: DateTime<Utc>) -> Result<()> {
        Ok(())
    }
    async fn create_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn get_owned_actions(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_actions_by_ids(&self, _: &[Uuid]) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_action(&self, _: &Uuid) -> Result<Option<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_next_unclaimed_actions(&self, _: i64) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn update_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn delete_action(&self, _: &Uuid) -> Result<()> {
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
    stall_prepare: bool,
    stall_before_resource: bool,
    prepare_delay: Duration,
    fail_after_prepare: bool,
    fail_cancel: bool,
    stall_cancel: bool,
    agent_resource: bool,
    cancellations: Mutex<Vec<(Uuid, Uuid)>>,
    prepared_handles: Mutex<Vec<(Uuid, Uuid)>>,
}
impl ScheduledAgentRunner for Runner {
    async fn prepare(&self, _: &ScheduledAction, handle: &mut ExecutionHandle) -> Result<()> {
        self.preparations.fetch_add(1, Ordering::SeqCst);
        self.prepared_handles
            .lock()
            .unwrap()
            .push((handle.session_id, handle.action_id));
        anyhow::ensure!(!self.fail_create, "resource unavailable");
        if self.stall_before_resource {
            std::future::pending::<()>().await;
        }
        handle.resource = Some(if self.agent_resource {
            ExecutionResource {
                resource_type: ExecutionResourceType::Agent,
                id: handle.session_id.to_string(),
            }
        } else {
            ExecutionResource {
                resource_type: ExecutionResourceType::Chat,
                id: "run-chat".into(),
            }
        });
        if self.stall_prepare {
            std::future::pending::<()>().await;
        }
        if !self.prepare_delay.is_zero() {
            tokio::time::sleep(self.prepare_delay).await;
        }
        anyhow::ensure!(
            !self.fail_after_prepare,
            "preparation failed after resource creation"
        );
        Ok(())
    }
    async fn cancel(&self, _: &ScheduledAction, handle: &ExecutionHandle) -> Result<()> {
        self.cancellations
            .lock()
            .unwrap()
            .push((handle.session_id, handle.action_id));
        if self.stall_cancel {
            std::future::pending::<()>().await;
        }
        anyhow::ensure!(!self.fail_cancel, "remote stop failed");
        Ok(())
    }
    async fn run(
        &self,
        _: &ScheduledAction,
        _: &ExecutionHandle,
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
struct Live(Mutex<Vec<ScheduledActionUpdate>>, bool);
impl ScheduledActionLiveUpdate for Live {
    async fn publish_update(&self, update: ScheduledActionUpdate) {
        self.0.lock().unwrap().push(update);
        if self.1 {
            std::future::pending::<()>().await;
        }
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
    assert!(executor.runner.cancellations.lock().unwrap().is_empty());
    assert!(matches!(
        progress.resource,
        Some(ExecutionResource {
            resource_type: ExecutionResourceType::Chat,
            ..
        })
    ));
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
async fn claim_is_fenced_to_the_snapshot_revision() {
    let executor = executor(Repo::default(), Runner::default());
    let mut action = action();
    action.configuration_revision = ConfigurationRevision::try_from(7).unwrap();
    executor.runner.finish.cancel();
    executor.execute_action(action).await.unwrap();
    drain(&executor).await;
    assert_eq!(*executor.repo.claimed_revisions.lock().unwrap(), [7]);
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
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
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
async fn failed_remote_cleanup_does_not_prevent_finalization() {
    let executor = executor(
        Repo::default(),
        Runner {
            fail_run: true,
            fail_cancel: true,
            ..Runner::default()
        },
    );
    executor.runner.finish.cancel();
    executor.execute_action(action()).await.unwrap();
    drain(&executor).await;
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    let records = executor.repo.records.lock().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].result["error"], "agent stream failed");
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn stalled_cleanup_and_bookkeeping_still_release_exactly_once() {
    let executor = executor(
        Repo {
            stall_persistence: true,
            ..Repo::default()
        },
        Runner {
            fail_run: true,
            stall_cancel: true,
            ..Runner::default()
        },
    );
    executor.runner.finish.cancel();
    executor.execute_action(action()).await.unwrap();
    executor.tracker.close();
    tokio::time::timeout(Duration::from_secs(31), executor.tracker.wait())
        .await
        .unwrap();
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    assert_eq!(executor.repo.records.lock().unwrap().len(), 1);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn cancellation_during_preparation_keeps_handle_and_established_resource() {
    let executor = executor(
        Repo::default(),
        Runner {
            stall_prepare: true,
            agent_resource: true,
            ..Runner::default()
        },
    );
    let run = event_run();
    let mut execution = Box::pin(executor.execute(&run, std::future::pending()));
    assert!(futures::poll!(&mut execution).is_pending());
    executor.cancellation.cancel();
    let result = execution.await;
    assert_eq!(result.outcome, EventRunOutcome::Interrupted);
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    let record = result.record.unwrap();
    let resource = record.execution_resource().unwrap().unwrap();
    assert_eq!(
        *executor.runner.cancellations.lock().unwrap(),
        *executor.runner.prepared_handles.lock().unwrap()
    );
    assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
    assert_eq!(record.resource_id.as_deref(), Some(resource.id.as_str()));
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
    assert!(executor.repo.records.lock().unwrap().is_empty());
    assert!(matches!(
        executor.live_updates.0.lock().unwrap().last(),
        Some(ScheduledActionUpdate::Stopped {
            chat_id: None,
            resource: Some(_),
            ..
        })
    ));
}

#[tokio::test]
async fn cancellation_before_preparation_response_still_addresses_the_remote_session() {
    let executor = executor(
        Repo::default(),
        Runner {
            stall_before_resource: true,
            agent_resource: true,
            ..Runner::default()
        },
    );
    let run = event_run();
    let mut execution = Box::pin(executor.execute(&run, std::future::pending()));
    assert!(futures::poll!(&mut execution).is_pending());
    executor.cancellation.cancel();
    let result = execution.await;
    assert_eq!(result.outcome, EventRunOutcome::Interrupted);
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    assert_eq!(
        *executor.runner.cancellations.lock().unwrap(),
        *executor.runner.prepared_handles.lock().unwrap()
    );
    assert!(result.record.unwrap().resource_id.is_none());
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn failed_preparation_cancels_the_preallocated_remote_identity() {
    let executor = executor(
        Repo::default(),
        Runner {
            fail_create: true,
            agent_resource: true,
            ..Runner::default()
        },
    );
    assert!(executor.execute_action(action()).await.is_err());
    drain(&executor).await;
    assert_eq!(
        *executor.runner.cancellations.lock().unwrap(),
        *executor.runner.prepared_handles.lock().unwrap()
    );
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    let records = executor.repo.records.lock().unwrap();
    assert!(records[0].resource_id.is_none());
    assert!(records[0].execution_resource().unwrap().is_none());
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn failed_preparation_retains_an_established_agent_resource() {
    let executor = executor(
        Repo::default(),
        Runner {
            fail_after_prepare: true,
            agent_resource: true,
            ..Runner::default()
        },
    );
    assert!(executor.execute_action(action()).await.is_err());
    drain(&executor).await;
    let records = executor.repo.records.lock().unwrap();
    assert_eq!(
        records[0]
            .execution_resource()
            .unwrap()
            .unwrap()
            .resource_type,
        ExecutionResourceType::Agent
    );
    assert!(!records[0].is_success);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn agent_progress_and_live_updates_never_use_the_legacy_chat_field() {
    let executor = executor(
        Repo::default(),
        Runner {
            agent_resource: true,
            ..Runner::default()
        },
    );
    let progress = executor.execute_action(action()).await.unwrap();
    assert!(progress.chat_id.is_none());
    let resource = progress.resource.unwrap();
    assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
    executor.runner.finish.cancel();
    drain(&executor).await;
    let updates = executor.live_updates.0.lock().unwrap();
    assert_eq!(updates.len(), 2);
    assert!(
        matches!(&updates[0], ScheduledActionUpdate::Started { chat_id: None, resource: Some(started), .. } if started == &resource)
    );
    assert!(
        matches!(&updates[1], ScheduledActionUpdate::Stopped { chat_id: None, resource: Some(stopped), is_success: true, .. } if stopped == &resource)
    );
    assert_eq!(
        executor.repo.records.lock().unwrap()[0]
            .execution_resource()
            .unwrap(),
        Some(resource)
    );
}

#[tokio::test]
async fn abandoned_manual_request_during_preparation_still_cleans_up() {
    let executor = executor(
        Repo::default(),
        Runner {
            stall_prepare: true,
            agent_resource: true,
            ..Runner::default()
        },
    );
    let mut request = Box::pin(executor.execute_action(action()));
    assert!(futures::poll!(&mut request).is_pending());
    tokio::task::yield_now().await;
    assert_eq!(executor.runner.preparations.load(Ordering::SeqCst), 1);
    drop(request);
    executor.cancellation.cancel();
    drain(&executor).await;
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert_eq!(executor.repo.records.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn preparation_and_execution_share_the_original_deadline() {
    let executor = executor(
        Repo::default(),
        Runner {
            prepare_delay: Duration::from_secs(15),
            ..Runner::default()
        },
    );
    let mut run = event_run();
    run.deadline = Utc::now() + chrono::Duration::seconds(20);
    let started = tokio::time::Instant::now();
    let result = executor.execute(&run, std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 1);
    assert!(started.elapsed() <= Duration::from_secs(21));
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn stalled_live_updates_preserve_resources_and_do_not_leak_claims() {
    let mut executor = executor(Repo::default(), Runner::default());
    executor.live_updates = Arc::new(Live(Mutex::default(), true));
    let mut request = Box::pin(executor.execute_action(action()));
    assert!(futures::poll!(&mut request).is_pending());
    tokio::task::yield_now().await;
    executor.cancellation.cancel();
    assert!(
        tokio::time::timeout(Duration::from_secs(11), request)
            .await
            .unwrap()
            .is_err()
    );
    drain(&executor).await;
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert_eq!(executor.runner.cancellations.lock().unwrap().len(), 1);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
    assert_eq!(
        executor.repo.records.lock().unwrap()[0]
            .resource_id
            .as_deref(),
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
