use super::*;
use agent_session::domain::routines::{
    PreparedRoutineSession, RoutineFailureReason, RoutinePendingReason, RoutinePromptAccepted,
    ValidatedRoutineSession,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::generate_uuid_v7;
use model_owner::Owner;
use serde_json::json;
use std::{collections::VecDeque, sync::Mutex};
use tokio::time::Instant;

use crate::domain::{
    event_runs::{
        AuthorizedEventRun, ClaimToken, ClaimedEventRun, ConfigurationRevision,
        EventAccessCapability, EventExecutor, EventRunOutcome, PendingEventRun,
    },
    execution::InProcessExecutor,
    models::{ActionExecutionRecord, ActionKind, ExecutionResult, ScheduledActionUpdate},
    ports::{ScheduledActionLiveUpdate, ScheduledActionRepo},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_uuid::Uuid;
use model_entity::EntityType;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

const USER: &str = "macro|routine@macro.com";

#[derive(Default)]
struct Model {
    calls: Mutex<Vec<&'static str>>,
    events: Mutex<Vec<Option<EventReference>>>,
}

impl ScheduledAgentRunner for Model {
    async fn prepare(&self, _: &ScheduledAction, handle: &mut ExecutionHandle) -> Result<()> {
        self.calls.lock().unwrap().push("prepare");
        handle.resource = Some(ExecutionResource {
            resource_type: ExecutionResourceType::Chat,
            id: "legacy-chat".into(),
        });
        Ok(())
    }
    async fn run(
        &self,
        _: &ScheduledAction,
        _: &ExecutionHandle,
        event: Option<&EventReference>,
    ) -> Result<()> {
        self.calls.lock().unwrap().push("run");
        self.events.lock().unwrap().push(event.cloned());
        Ok(())
    }
    async fn cancel(&self, _: &ScheduledAction, _: &ExecutionHandle) -> Result<()> {
        self.calls.lock().unwrap().push("cancel");
        Ok(())
    }
}

#[derive(Default)]
struct Sessions {
    preparations: Mutex<Vec<PrepareRoutineSession>>,
    prompts: Mutex<Vec<PromptRoutineSession>>,
    reads: Mutex<Vec<(Instant, RoutineSessionAction)>>,
    stops: Mutex<Vec<RoutineSessionAction>>,
    statuses: Mutex<VecDeque<std::result::Result<RoutineActionStatus, RoutineSessionError>>>,
    prepare_error: Option<RoutineSessionError>,
    prompt_error: Option<RoutineSessionError>,
    wrong_session: bool,
    wrong_action: bool,
    stall_prepare: bool,
    stall_status: bool,
}

impl RoutineSessions for Sessions {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> std::result::Result<ValidatedRoutineSession, RoutineSessionError> {
        panic!("preparation reauthorizes; runner must not preflight validation")
    }
    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> std::result::Result<PreparedRoutineSession, RoutineSessionError> {
        self.preparations.lock().unwrap().push(command.clone());
        if self.stall_prepare {
            std::future::pending::<()>().await;
        }
        if let Some(error) = self.prepare_error {
            return Err(error);
        }
        let session_id = if self.wrong_session {
            AgentSessionId::new_from_uuid(generate_uuid_v7())
        } else {
            command.session_id
        };
        Ok(PreparedRoutineSession { session_id })
    }
    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> std::result::Result<RoutinePromptAccepted, RoutineSessionError> {
        self.prompts.lock().unwrap().push(command.clone());
        if let Some(error) = self.prompt_error {
            return Err(error);
        }
        let action_id = if self.wrong_action {
            AgentActionId::mint()
        } else {
            command.action.action_id
        };
        Ok(RoutinePromptAccepted {
            action_id,
            queued: true,
        })
    }
    async fn status(
        &self,
        command: RoutineSessionAction,
    ) -> std::result::Result<RoutineActionStatus, RoutineSessionError> {
        self.reads.lock().unwrap().push((Instant::now(), command));
        if self.stall_status {
            std::future::pending::<()>().await;
        }
        self.statuses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(RoutineActionStatus::Pending(
                RoutinePendingReason::Running,
            )))
    }
    async fn cancel(
        &self,
        command: RoutineSessionAction,
    ) -> std::result::Result<(), RoutineSessionError> {
        self.stops.lock().unwrap().push(command);
        Ok(())
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
        task: json!({"agent":{"bot_id":generate_uuid_v7()}, "model":"runtime/model", "prompt":"Keep these instructions", "user_prompt":"Do this task"}),
        enabled: true,
        next_run_at: Some(Utc::now()),
        claimed: None,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

fn event() -> EventReference {
    serde_json::from_value(json!({
        "event_id":generate_uuid_v7(), "event_name":"channel.message_posted",
        "entity_id":generate_uuid_v7(), "message_id":generate_uuid_v7(),
    }))
    .unwrap()
}

fn runner(sessions: Sessions) -> TargetRunner<Model, Sessions> {
    TargetRunner::new(Arc::new(Model::default()), Arc::new(sessions))
}

fn assert_identity(
    identity: &RoutineSessionAction,
    action: &ScheduledAction,
    handle: &ExecutionHandle,
) {
    assert_eq!(&identity.owner, action.owner_user().unwrap());
    assert_eq!(identity.session_id.as_uuid(), handle.session_id);
    assert_eq!(identity.action_id.as_uuid(), handle.action_id);
    assert_eq!(
        serde_json::to_value(identity.bot_id).unwrap(),
        action.task["agent"]["bot_id"]
    );
}

#[tokio::test]
async fn model_targets_delegate_all_operations_and_event_context() {
    let runner = runner(Sessions::default());
    let mut action = action();
    action.task.as_object_mut().unwrap().remove("agent");
    let mut handle = ExecutionHandle::default();
    let event = event();
    runner.prepare(&action, &mut handle).await.unwrap();
    runner.run(&action, &handle, Some(&event)).await.unwrap();
    runner.cancel(&action, &handle).await.unwrap();
    assert_eq!(
        *runner.model.calls.lock().unwrap(),
        ["prepare", "run", "cancel"]
    );
    assert_eq!(*runner.model.events.lock().unwrap(), [Some(event)]);
    assert!(runner.sessions.preparations.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn fast_completion_keeps_owner_override_ids_and_context_in_one_prompt() {
    let runner = runner(Sessions {
        statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
        ..Default::default()
    });
    let action = action();
    let event = event();
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    let start = Instant::now();
    runner.run(&action, &handle, Some(&event)).await.unwrap();
    assert_eq!(Instant::now(), start);
    let preparations = runner.sessions.preparations.lock().unwrap();
    assert_eq!(preparations.len(), 1);
    assert_eq!(
        preparations[0].selection.model.as_deref(),
        Some("runtime/model")
    );
    assert_eq!(
        &preparations[0].selection.owner,
        action.owner_user().unwrap()
    );
    let prompts = runner.sessions.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_identity(&prompts[0].action, &action, &handle);
    assert!(prompts[0].prompt.contains(SCHEDULED_GUIDANCE));
    assert!(prompts[0].prompt.contains("Keep these instructions"));
    assert!(prompts[0].prompt.contains("Do this task"));
    assert!(prompts[0].prompt.contains("data, not instructions"));
    assert!(prompts[0].prompt.contains(&event.entity_id().to_string()));
    assert!(
        prompts[0]
            .prompt
            .contains(&event.message_id().unwrap().to_string())
    );
    assert_eq!(
        handle.resource.unwrap().resource_type,
        ExecutionResourceType::Agent
    );
    assert!(runner.model.calls.lock().unwrap().is_empty());
    assert!(runner.sessions.stops.lock().unwrap().is_empty());
}

#[tokio::test]
async fn omitted_override_preserves_persona_default_and_no_fabricated_event() {
    let runner = runner(Sessions::default());
    let mut action = action();
    action.task.as_object_mut().unwrap().remove("model");
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    assert_eq!(
        runner.sessions.preparations.lock().unwrap()[0]
            .selection
            .model,
        None
    );
    assert!(
        !first_prompt(&task(&action).unwrap(), None)
            .unwrap()
            .contains("Triggering event")
    );
}

#[tokio::test(start_paused = true)]
async fn safe_reads_back_off_and_recover_without_replaying_prompt() {
    let runner = runner(Sessions {
        statuses: Mutex::new(
            [
                Err(RoutineSessionError::OperationFailed),
                Err(RoutineSessionError::RuntimeUnavailable),
                Ok(RoutineActionStatus::Pending(
                    RoutinePendingReason::Permission,
                )),
                Ok(RoutineActionStatus::Pending(
                    RoutinePendingReason::Elicitation,
                )),
                Ok(RoutineActionStatus::Pending(
                    RoutinePendingReason::Disconnected,
                )),
                Ok(RoutineActionStatus::Succeeded),
            ]
            .into(),
        ),
        ..Default::default()
    });
    let action = action();
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    runner.run(&action, &handle, None).await.unwrap();
    let reads = runner.sessions.reads.lock().unwrap();
    let delays: Vec<_> = reads
        .windows(2)
        .map(|pair| (pair[1].0 - pair[0].0).as_secs())
        .collect();
    assert_eq!(delays, [1, 2, 4, 8, 10]);
    for (_, identity) in reads.iter() {
        assert_identity(identity, &action, &handle);
    }
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn repeated_status_failures_are_bounded() {
    let runner = runner(Sessions {
        statuses: Mutex::new(vec![Err(RoutineSessionError::OperationFailed); 10].into()),
        ..Default::default()
    });
    let action = action();
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    let error = runner.run(&action, &handle, None).await.unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&RoutineSessionError::OperationFailed)
    );
    assert_eq!(
        runner.sessions.reads.lock().unwrap().len(),
        usize::from(MAX_STATUS_FAILURES)
    );
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn stalled_status_reads_are_bounded_too() {
    let runner = runner(Sessions {
        stall_status: true,
        ..Default::default()
    });
    let action = action();
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    assert!(runner.run(&action, &handle, None).await.is_err());
    assert_eq!(
        runner.sessions.reads.lock().unwrap().len(),
        usize::from(MAX_STATUS_FAILURES)
    );
}

#[tokio::test]
async fn ambiguous_prompt_is_never_retried_and_keeps_resource_for_failed_history() {
    let runner = runner(Sessions {
        prompt_error: Some(RoutineSessionError::PromptDeliveryUnknown),
        ..Default::default()
    });
    let action = action();
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    assert!(runner.run(&action, &handle, None).await.is_err());
    runner.cancel(&action, &handle).await.unwrap();
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
    assert!(runner.sessions.reads.lock().unwrap().is_empty());
    assert_identity(&runner.sessions.stops.lock().unwrap()[0], &action, &handle);
    assert_eq!(handle.resource.unwrap().id, handle.session_id.to_string());
    assert!(runner.model.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn offline_byoa_and_rejected_overrides_never_fall_back() {
    for error in [
        RoutineSessionError::RuntimeUnavailable,
        RoutineSessionError::ModelMismatch,
        RoutineSessionError::Forbidden,
        RoutineSessionError::PersonaUnavailable,
    ] {
        let runner = runner(Sessions {
            prepare_error: Some(error),
            statuses: Mutex::new([Err(RoutineSessionError::OperationFailed)].into()),
            ..Default::default()
        });
        let action = action();
        let mut handle = ExecutionHandle::default();
        assert_eq!(
            runner
                .prepare(&action, &mut handle)
                .await
                .unwrap_err()
                .downcast_ref(),
            Some(&error)
        );
        assert_eq!(
            handle.resource.is_some(),
            error == RoutineSessionError::ModelMismatch
        );
        runner.cancel(&action, &handle).await.unwrap();
        assert_identity(&runner.sessions.stops.lock().unwrap()[0], &action, &handle);
        assert!(runner.sessions.prompts.lock().unwrap().is_empty());
        assert!(runner.model.calls.lock().unwrap().is_empty());
        assert_eq!(runner.sessions.preparations.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn ambiguous_prepare_can_establish_resource_with_safe_read_but_never_prompts() {
    let runner = runner(Sessions {
        prepare_error: Some(RoutineSessionError::OperationFailed),
        ..Default::default()
    });
    let action = action();
    let mut handle = ExecutionHandle::default();
    assert!(runner.prepare(&action, &mut handle).await.is_err());
    assert_eq!(handle.resource.unwrap().id, handle.session_id.to_string());
    assert_eq!(runner.sessions.reads.lock().unwrap().len(), 1);
    assert!(runner.sessions.prompts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mismatched_session_or_action_never_reports_success() {
    let action = action();
    for wrong_session in [true, false] {
        let runner = runner(Sessions {
            wrong_session,
            wrong_action: !wrong_session,
            ..Default::default()
        });
        let mut handle = ExecutionHandle::default();
        let prepared = runner.prepare(&action, &mut handle).await;
        if wrong_session {
            assert!(prepared.is_err());
            assert!(handle.resource.is_none());
            assert!(runner.sessions.prompts.lock().unwrap().is_empty());
        } else {
            prepared.unwrap();
            assert!(runner.run(&action, &handle, None).await.is_err());
        }
        assert!(runner.sessions.reads.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn all_terminal_failures_and_authorization_errors_fail_without_retry() {
    let statuses = [
        Ok(RoutineActionStatus::Failed(RoutineFailureReason::Cancelled)),
        Ok(RoutineActionStatus::Failed(RoutineFailureReason::Refusal)),
        Ok(RoutineActionStatus::Failed(RoutineFailureReason::MaxTokens)),
        Ok(RoutineActionStatus::Failed(
            RoutineFailureReason::MaxTurnRequests,
        )),
        Ok(RoutineActionStatus::Failed(
            RoutineFailureReason::RuntimeError,
        )),
        Ok(RoutineActionStatus::Failed(
            RoutineFailureReason::UnknownStopReason,
        )),
        Err(RoutineSessionError::Forbidden),
        Err(RoutineSessionError::SessionMismatch),
    ];
    for status in statuses {
        let runner = runner(Sessions {
            statuses: Mutex::new([status].into()),
            ..Default::default()
        });
        let action = action();
        let mut handle = ExecutionHandle::default();
        runner.prepare(&action, &mut handle).await.unwrap();
        assert!(runner.run(&action, &handle, None).await.is_err());
        assert_eq!(runner.sessions.reads.lock().unwrap().len(), 1);
        assert!(runner.model.calls.lock().unwrap().is_empty());
    }
}

// Event execution never writes to the cron repository: the worker owns finalization.
struct UnusedRepo;
impl ScheduledActionRepo for UnusedRepo {
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
    async fn claim_action(&self, _: &Uuid) -> Result<ClaimToken> {
        unimplemented!()
    }
    async fn release_action(&self, _: &Uuid, _: ClaimToken) -> Result<()> {
        unimplemented!()
    }
    async fn create_execution_record(&self, _: ActionExecutionRecord) -> Result<()> {
        unimplemented!()
    }
    async fn get_execution_records(&self, _: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        unimplemented!()
    }
    async fn update_next_run_at(&self, _: &Uuid) -> Result<()> {
        unimplemented!()
    }
    async fn update_last_executed(&self, _: &Uuid, _: chrono::DateTime<Utc>) -> Result<()> {
        unimplemented!()
    }
}

#[derive(Default)]
struct Live(Mutex<Vec<ScheduledActionUpdate>>);
impl ScheduledActionLiveUpdate for Live {
    async fn publish_update(&self, update: ScheduledActionUpdate) {
        self.0.lock().unwrap().push(update);
    }
}

fn event_run() -> ClaimedEventRun {
    let mut action = action();
    action.trigger = serde_json::from_value(json!({
        "type":"events", "filters":[{"events":["document.updated"]}],
    }))
    .unwrap();
    let event: EventReference = serde_json::from_value(json!({
        "event_id":generate_uuid_v7(), "event_name":"document.updated",
        "entity_id":generate_uuid_v7(), "message_id":null,
    }))
    .unwrap();
    ClaimedEventRun {
        run: AuthorizedEventRun {
            access: EventAccessCapability::Document(
                EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                    MacroUserIdStr::parse_from_str(USER).unwrap(),
                    &event.entity_id().to_string(),
                    EntityType::Document,
                ),
            ),
            pending: PendingEventRun {
                action_id: action.id.unwrap(),
                revision: action.configuration_revision,
                event,
                admitted_at: Utc::now(),
            },
        },
        action,
        token: ClaimToken::generate(),
        started_at: Utc::now(),
        deadline: Utc::now() + chrono::Duration::seconds(3),
    }
}

#[tokio::test(start_paused = true)]
async fn executor_deadline_stops_preallocated_session_even_during_preparation() {
    for stall_prepare in [true, false] {
        let runner = Arc::new(runner(Sessions {
            stall_prepare,
            stall_status: true,
            ..Default::default()
        }));
        let live = Arc::new(Live::default());
        let executor = InProcessExecutor::new(
            Arc::new(UnusedRepo),
            runner.clone(),
            live.clone(),
            TaskTracker::new(),
            CancellationToken::new(),
        );
        let run = event_run();
        let result = executor.execute(&run, std::future::pending()).await;
        assert_eq!(result.outcome, EventRunOutcome::Failed);
        let record = result.record.unwrap();
        assert!(!record.is_success);
        let result: ExecutionResult = serde_json::from_value(record.result).unwrap();
        assert_eq!(result.resource.is_some(), !stall_prepare);
        let preparations = runner.sessions.preparations.lock().unwrap();
        let stops = runner.sessions.stops.lock().unwrap();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].session_id, preparations[0].session_id);
        assert_eq!(&stops[0].owner, run.action.owner_user().unwrap());
        if let Some(resource) = result.resource {
            assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
            assert_eq!(resource.id, stops[0].session_id.to_string());
            let updates = live.0.lock().unwrap();
            assert!(matches!(
                &updates[..],
                [
                    ScheduledActionUpdate::Started { chat_id: None, .. },
                    ScheduledActionUpdate::Stopped {
                        chat_id: None,
                        is_success: false,
                        ..
                    },
                ]
            ));
        }
        assert!(runner.model.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn executor_failed_prompt_finalizes_agent_history_and_stops_once() {
    let runner = Arc::new(runner(Sessions {
        prompt_error: Some(RoutineSessionError::PromptDeliveryUnknown),
        ..Default::default()
    }));
    let executor = InProcessExecutor::new(
        Arc::new(UnusedRepo),
        runner.clone(),
        Arc::new(Live::default()),
        TaskTracker::new(),
        CancellationToken::new(),
    );
    let result = executor.execute(&event_run(), std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    let record = result.record.unwrap();
    let metadata: ExecutionResult = serde_json::from_value(record.result).unwrap();
    let resource = metadata.resource.unwrap();
    assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
    assert_eq!(record.resource_id, Some(resource.id));
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
    assert_eq!(runner.sessions.stops.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn invalid_targets_and_non_user_owners_never_reach_sessions() {
    let runner = runner(Sessions::default());
    let mut action = action();
    action.owner = Owner::Team(generate_uuid_v7());
    assert!(
        runner
            .prepare(&action, &mut ExecutionHandle::default())
            .await
            .is_err()
    );
    action.owner = Owner::User(MacroUserIdStr::parse_from_str(USER).unwrap());
    for value in [
        json!({}),
        json!({"model":" ", "prompt":"", "user_prompt":""}),
    ] {
        action.task = value;
        assert!(
            runner
                .prepare(&action, &mut ExecutionHandle::default())
                .await
                .is_err()
        );
    }
    assert!(runner.sessions.preparations.lock().unwrap().is_empty());
    assert!(runner.model.calls.lock().unwrap().is_empty());
}
