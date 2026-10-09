use super::*;
use agent_session::domain::routines::{
    PreparedRoutineSession, RoutineFailureReason, RoutinePendingReason, RoutinePromptAccepted,
    ValidatedRoutineSession,
};
use chrono::{TimeZone, Utc};
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
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel, ViewOnly};
use macro_uuid::Uuid;
use model_entity::EntityType;
use rootcause::Report;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use trigger_context::{
    ContextPerson, RoutineContext, RoutineEvent, RoutineFiring,
    RoutineTrigger as ContextRoutineTrigger, TaskSnapshot, TriggerContext,
};

const USER: &str = "macro|routine@macro.com";

struct NoModelAdmission;

impl ai_billing::AiAdmissionService for NoModelAdmission {
    fn admit<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
        _: ai_usage::AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        panic!("agent funding must be decided by the session/harness service")
    }
}

#[tokio::test]
async fn agent_targets_delegate_admission_and_never_apply_the_model_gate() {
    use ai_billing::{AiAdmissionError, DenyReason};

    for admission_error in [
        None,
        Some(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
        Some(AiAdmissionError::Unavailable),
    ] {
        let runner = Arc::new(runner(Sessions {
            prepare_error: admission_error.map(RoutineSessionError::Admission),
            statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
            ..Default::default()
        }));
        let live = Arc::new(Live::default());
        let executor = InProcessExecutor::new(
            Arc::new(UnusedRepo),
            runner.clone(),
            live.clone(),
            TaskTracker::new(),
            CancellationToken::new(),
        )
        .with_admission(Arc::new(NoModelAdmission));
        let run = event_run();
        let result = executor.execute(&run, std::future::pending()).await;
        let record = result.record.unwrap();
        let preparations = runner.sessions.preparations.lock().unwrap();
        assert_eq!(preparations.len(), 1);
        assert_eq!(
            &preparations[0].selection.owner,
            run.action.owner_user().unwrap()
        );
        assert!(runner.sessions.stops.lock().unwrap().is_empty());
        if let Some(error) = admission_error {
            assert_eq!(result.outcome, EventRunOutcome::Failed);
            assert!(!record.is_success);
            assert!(record.resource_id.is_none());
            assert_eq!(record.result["error"], error.to_string());
            assert!(runner.sessions.prompts.lock().unwrap().is_empty());
            assert!(runner.sessions.reads.lock().unwrap().is_empty());
            assert!(live.0.lock().unwrap().is_empty());
        } else {
            assert_eq!(result.outcome, EventRunOutcome::Succeeded);
            assert!(record.is_success);
            assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
        }
    }
}

#[tokio::test]
async fn agent_preparation_preserves_typed_admission_failures() {
    use ai_billing::{AiAdmissionError, DenyReason};
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let runner = runner(Sessions {
            prepare_error: Some(RoutineSessionError::Admission(error)),
            ..Default::default()
        });
        let mut handle = ExecutionHandle::default();
        let returned = runner.prepare(&action(), &mut handle).await.unwrap_err();
        assert_eq!(returned.downcast_ref::<AiAdmissionError>(), Some(&error));
        assert!(handle.resource.is_none());
        assert!(runner.sessions.reads.lock().unwrap().is_empty());
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

fn event() -> AuthorizedEventRun {
    let event: EventReference = serde_json::from_value(json!({
        "event_id":generate_uuid_v7(), "event_name":"channel.message_posted",
        "entity_id":generate_uuid_v7(), "message_id":generate_uuid_v7(),
    }))
    .unwrap();
    AuthorizedEventRun {
        access: EventAccessCapability::Channel(
            EntityAccessReceipt::<ViewOnly>::dangerously_assert_authenticated_user(
                MacroUserIdStr::parse_from_str(USER).unwrap(),
                &event.entity_id().to_string(),
                EntityType::Channel,
            ),
        ),
        pending: PendingEventRun {
            action_id: generate_uuid_v7(),
            revision: ConfigurationRevision::INITIAL,
            event,
            admitted_at: Utc::now(),
        },
    }
}

fn manual() -> RoutineRun<'static> {
    RoutineRun::Manual {
        requested_at: Utc::now(),
    }
}

/// Supplies one event, or finds every event unreadable.
struct Events(Option<RoutineEvent>);

impl RoutineEventReader for Events {
    async fn read_event(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &AuthorizedEventRun,
    ) -> std::result::Result<RoutineEvent, Report> {
        self.0
            .clone()
            .ok_or_else(|| rootcause::report!("the event is no longer available"))
    }
}

fn runner(sessions: Sessions) -> TargetRunner<Sessions, Events> {
    TargetRunner::new(Arc::new(sessions), Arc::new(Events(None)))
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
        action
            .task
            .get("agent")
            .filter(|agent| !agent.is_null())
            .map(|agent| agent["bot_id"].clone())
            .unwrap_or_else(|| json!(bot_id::MACRO_NEW_BOT_ID))
    );
}

#[tokio::test]
async fn model_targets_use_macro_sessions_with_the_selected_model_and_event_context() {
    for event in [None, Some(event())] {
        let runner = runner(Sessions {
            statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
            ..Default::default()
        });
        let mut action = action();
        action.task.as_object_mut().unwrap().remove("agent");
        let mut handle = ExecutionHandle::default();
        runner.prepare(&action, &mut handle).await.unwrap();
        let firing = match &event {
            Some(run) => RoutineRun::Event(run),
            None => manual(),
        };
        runner.run(&action, &handle, firing).await.unwrap();
        runner.cancel(&action, &handle).await.unwrap();

        let preparations = runner.sessions.preparations.lock().unwrap();
        assert_eq!(preparations.len(), 1);
        assert_eq!(preparations[0].selection.bot_id, bot_id::MACRO_NEW_BOT_ID);
        assert_eq!(
            preparations[0].selection.model.as_deref(),
            Some("runtime/model")
        );
        assert_eq!(
            &preparations[0].selection.owner,
            action.owner_user().unwrap()
        );
        assert_eq!(preparations[0].session_id.as_uuid(), handle.session_id);

        let prompts = runner.sessions.prompts.lock().unwrap();
        assert_eq!(prompts.len(), 1);
        assert_eq!(
            prompts[0].prompt,
            first_prompt(
                &task(&action).unwrap(),
                prompts[0].context.as_ref(),
                event.as_ref().map(|run| &run.pending.event)
            )
            .unwrap()
        );
        let identity = &prompts[0].action;
        assert_eq!(identity.bot_id, bot_id::MACRO_NEW_BOT_ID);
        assert_eq!(identity.session_id.as_uuid(), handle.session_id);
        assert_eq!(identity.action_id.as_uuid(), handle.action_id);
        assert_eq!(&identity.owner, action.owner_user().unwrap());
        assert_identity(
            &runner.sessions.reads.lock().unwrap()[0].1,
            &action,
            &handle,
        );
        assert_identity(&runner.sessions.stops.lock().unwrap()[0], &action, &handle);
        let resource = handle.resource.unwrap();
        assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
        assert_eq!(resource.id, handle.session_id.to_string());
    }
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
    runner
        .run(&action, &handle, RoutineRun::Event(&event))
        .await
        .unwrap();
    let event = &event.pending.event;
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
    assert!(prompts[0].context.is_none());
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
        !first_prompt(&task(&action).unwrap(), None, None)
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
    runner.run(&action, &handle, manual()).await.unwrap();
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
    let error = runner.run(&action, &handle, manual()).await.unwrap_err();
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
    assert!(runner.run(&action, &handle, manual()).await.is_err());
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
    assert!(runner.run(&action, &handle, manual()).await.is_err());
    runner.cancel(&action, &handle).await.unwrap();
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
    assert!(runner.sessions.reads.lock().unwrap().is_empty());
    assert_identity(&runner.sessions.stops.lock().unwrap()[0], &action, &handle);
    assert_eq!(handle.resource.unwrap().id, handle.session_id.to_string());
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
            assert!(runner.run(&action, &handle, manual()).await.is_err());
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
        assert!(runner.run(&action, &handle, manual()).await.is_err());
        assert_eq!(runner.sessions.reads.lock().unwrap().len(), 1);
    }
}

// Event execution never writes to the cron repository: the worker owns finalization.
struct UnusedRepo;
impl ScheduledActionRepo for UnusedRepo {
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
    async fn claim_action(
        &self,
        _: &Uuid,
        _: ConfigurationRevision,
        _expected_next_run_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<ClaimToken> {
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
    }
}

#[tokio::test]
async fn executor_failed_model_prompt_keeps_session_history_and_stops_once() {
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
    let mut run = event_run();
    run.action.task.as_object_mut().unwrap().remove("agent");
    let result = executor.execute(&run, std::future::pending()).await;
    assert_eq!(result.outcome, EventRunOutcome::Failed);
    let record = result.record.unwrap();
    let metadata: ExecutionResult = serde_json::from_value(record.result).unwrap();
    let resource = metadata.resource.unwrap();
    assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
    assert_eq!(record.resource_id, Some(resource.id));
    assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
    assert_eq!(runner.sessions.stops.lock().unwrap().len(), 1);
    assert_eq!(
        runner.sessions.stops.lock().unwrap()[0].bot_id,
        bot_id::MACRO_NEW_BOT_ID
    );
}

#[tokio::test]
async fn executor_failed_prompt_finalizes_agent_history_and_stops_once() {
    use ai_billing::{AiAdmissionError, DenyReason};
    for error in [
        RoutineSessionError::PromptDeliveryUnknown,
        RoutineSessionError::Admission(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
        RoutineSessionError::Admission(AiAdmissionError::Unavailable),
    ] {
        let runner = Arc::new(runner(Sessions {
            prompt_error: Some(error),
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
        let result = executor.execute(&event_run(), std::future::pending()).await;
        assert_eq!(result.outcome, EventRunOutcome::Failed);
        let record = result.record.unwrap();
        let metadata: ExecutionResult = serde_json::from_value(record.result).unwrap();
        let resource = metadata.resource.unwrap();
        assert_eq!(resource.resource_type, ExecutionResourceType::Agent);
        assert_eq!(record.resource_id, Some(resource.id));
        assert_eq!(metadata.error, Some(error.to_string()));
        assert_eq!(runner.sessions.prompts.lock().unwrap().len(), 1);
        assert_eq!(runner.sessions.stops.lock().unwrap().len(), 1);
        assert!(matches!(
            live.0.lock().unwrap().as_slice(),
            [
                ScheduledActionUpdate::Started { .. },
                ScheduledActionUpdate::Stopped {
                    is_success: false,
                    ..
                },
            ]
        ));
    }
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
}

#[tokio::test]
async fn a_scheduled_run_tells_the_agent_which_routine_fired_and_on_what_schedule() {
    let runner = runner(Sessions {
        statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
        ..Default::default()
    });
    let routine_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-0123456789ab").unwrap();
    let scheduled_for = Utc.with_ymd_and_hms(2026, 10, 8, 13, 0, 0).unwrap();
    let action = ScheduledAction {
        id: Some(routine_id),
        owner: Owner::User(MacroUserIdStr::parse_from_str("macro|dana@example.com").unwrap()),
        name: "Morning digest".into(),
        trigger: serde_json::from_value(json!({"type": "multiple", "triggers": [
            {"type": "cron", "schedule": "0 0 9 * * MON-FRI", "timezone": "America/New_York"},
            {"type": "cron", "schedule": "0 0 12 * * SAT", "timezone": "UTC"},
        ]}))
        .unwrap(),
        kind: ActionKind::Agent,
        task: json!({
            "model": "runtime/model",
            "prompt": "Summarize my unread email.",
            "user_prompt": "Post it in #digest.",
        }),
        enabled: true,
        next_run_at: Some(scheduled_for),
        claimed: None,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        created_at: scheduled_for,
        updated_at: scheduled_for,
    };
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    runner
        .run(&action, &handle, RoutineRun::Scheduled { scheduled_for })
        .await
        .unwrap();

    let prompts = runner.sessions.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(
        prompts[0].prompt,
        format!("{SCHEDULED_GUIDANCE}\n\nUser task:\nPost it in #digest.")
    );
    assert_eq!(
        prompts[0].context,
        Some(TriggerContext::Routine(RoutineContext {
            routine_id,
            name: "Morning digest".into(),
            owner: ContextPerson {
                id: "macro|dana@example.com".into(),
                name: "dana@example.com".into(),
                email: Some("dana@example.com".into()),
            },
            instructions: "Summarize my unread email.".into(),
            triggers: vec![
                ContextRoutineTrigger::Schedule {
                    cron: "0 0 9 * * MON-FRI".into(),
                    timezone: "America/New_York".into(),
                },
                ContextRoutineTrigger::Schedule {
                    cron: "0 0 12 * * SAT".into(),
                    timezone: "UTC".into(),
                },
            ],
            firing: RoutineFiring::Scheduled {
                scheduled_for,
                schedule:
                    "cron `0 0 9 * * MON-FRI` in America/New_York; cron `0 0 12 * * SAT` in UTC"
                        .into(),
            },
        }))
    );
}

#[tokio::test]
async fn a_task_status_change_hands_the_agent_the_task_instead_of_its_ids() {
    let task_status_changed = RoutineEvent::TaskStatusChanged {
        task: TaskSnapshot {
            id: "01928f3e-6a2b-7c3d-8e4f-000000007a5c".into(),
            title: "Login page crashes on Safari".into(),
            markdown: "Steps: open login on Safari 17.".into(),
            status: Some("In review".into()),
            priority: Some("High".into()),
            due: Some(Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap()),
            assignees: vec![ContextPerson {
                id: "macro|sam@example.com".into(),
                name: "sam@example.com".into(),
                email: Some("sam@example.com".into()),
            }],
            project: None,
        },
    };
    let runner = TargetRunner::new(
        Arc::new(Sessions {
            statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
            ..Default::default()
        }),
        Arc::new(Events(Some(task_status_changed.clone()))),
    );
    let routine_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-0123456789ab").unwrap();
    let owner = MacroUserIdStr::parse_from_str("macro|dana@example.com").unwrap();
    let at = Utc.with_ymd_and_hms(2026, 10, 8, 13, 0, 0).unwrap();
    let action = ScheduledAction {
        id: Some(routine_id),
        owner: Owner::User(owner.clone()),
        name: "Review handoff".into(),
        trigger: serde_json::from_value(json!({
            "type": "events",
            "filters": [
                {
                    "events": ["task.status_changed", "task.created"],
                    "ids": ["01928f3e-6a2b-7c3d-8e4f-000000007a5c"],
                    "condition": "Is the task ready for review?",
                },
                {
                    "events": ["task.property_changed"],
                    "condition": "Did someone ask for a second reviewer?",
                },
                {"events": ["document.created"]},
            ],
        }))
        .unwrap(),
        kind: ActionKind::Agent,
        task: json!({
            "model": "runtime/model",
            "prompt": "Ask a reviewer to pick it up.",
            "user_prompt": "Tag the right reviewer.",
        }),
        enabled: true,
        next_run_at: None,
        claimed: None,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: Some(at),
        created_at: at,
        updated_at: at,
    };
    let event: EventReference = serde_json::from_value(json!({
        "event_id": "01928f3e-6a2b-7c3d-8e4f-0123456789cd",
        "event_name": "task.status_changed",
        "entity_id": "01928f3e-6a2b-7c3d-8e4f-000000007a5c",
        "message_id": null,
    }))
    .unwrap();
    let run = AuthorizedEventRun {
        access: EventAccessCapability::Document(
            EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_authenticated_user(
                owner,
                "01928f3e-6a2b-7c3d-8e4f-000000007a5c",
                EntityType::Document,
            ),
        ),
        pending: PendingEventRun {
            action_id: routine_id,
            revision: ConfigurationRevision::INITIAL,
            event,
            admitted_at: at,
        },
    };
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    runner
        .run(&action, &handle, RoutineRun::Event(&run))
        .await
        .unwrap();

    let prompts = runner.sessions.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(
        prompts[0].prompt,
        format!("{SCHEDULED_GUIDANCE}\n\nUser task:\nTag the right reviewer.")
    );
    assert_eq!(
        prompts[0].context,
        Some(TriggerContext::Routine(RoutineContext {
            routine_id,
            name: "Review handoff".into(),
            owner: ContextPerson {
                id: "macro|dana@example.com".into(),
                name: "dana@example.com".into(),
                email: Some("dana@example.com".into()),
            },
            instructions: "Ask a reviewer to pick it up.".into(),
            triggers: vec![
                ContextRoutineTrigger::Events {
                    events: vec!["document.created".into()],
                    entity_ids: Vec::new(),
                    condition: None,
                },
                ContextRoutineTrigger::Events {
                    events: vec!["task.created".into(), "task.status_changed".into()],
                    entity_ids: vec![
                        Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000007a5c").unwrap()
                    ],
                    condition: Some("Is the task ready for review?".into()),
                },
                ContextRoutineTrigger::Events {
                    events: vec!["task.property_changed".into()],
                    entity_ids: Vec::new(),
                    condition: Some("Did someone ask for a second reviewer?".into()),
                },
            ],
            firing: RoutineFiring::Event {
                event: Box::new(task_status_changed),
                conditions: vec![
                    "Did someone ask for a second reviewer?".into(),
                    "Is the task ready for review?".into(),
                ],
            },
        }))
    );
}

#[tokio::test]
async fn a_manual_run_tells_the_agent_its_owner_started_it() {
    let runner = runner(Sessions {
        statuses: Mutex::new([Ok(RoutineActionStatus::Succeeded)].into()),
        ..Default::default()
    });
    let routine_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-0123456789ab").unwrap();
    let requested_at = Utc.with_ymd_and_hms(2026, 10, 8, 15, 30, 0).unwrap();
    let action = ScheduledAction {
        id: Some(routine_id),
        owner: Owner::User(MacroUserIdStr::parse_from_str("macro|dana@example.com").unwrap()),
        name: "Inbox triage".into(),
        trigger: serde_json::from_value(json!({
            "type": "events",
            "filters": [{"events": ["email.message_received"]}],
        }))
        .unwrap(),
        kind: ActionKind::Agent,
        task: json!({
            "model": "runtime/model",
            "prompt": "Label my new email.",
            "user_prompt": "Use the Finance label for invoices.",
        }),
        enabled: true,
        next_run_at: None,
        claimed: None,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: Some(requested_at),
        created_at: requested_at,
        updated_at: requested_at,
    };
    let mut handle = ExecutionHandle::default();
    runner.prepare(&action, &mut handle).await.unwrap();
    runner
        .run(&action, &handle, RoutineRun::Manual { requested_at })
        .await
        .unwrap();

    let prompts = runner.sessions.prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(
        prompts[0].prompt,
        format!("{SCHEDULED_GUIDANCE}\n\nUser task:\nUse the Finance label for invoices.")
    );
    assert_eq!(
        prompts[0].context,
        Some(TriggerContext::Routine(RoutineContext {
            routine_id,
            name: "Inbox triage".into(),
            owner: ContextPerson {
                id: "macro|dana@example.com".into(),
                name: "dana@example.com".into(),
                email: Some("dana@example.com".into()),
            },
            instructions: "Label my new email.".into(),
            triggers: vec![ContextRoutineTrigger::Events {
                events: vec!["email.message_received".into()],
                entity_ids: Vec::new(),
                condition: None,
            }],
            firing: RoutineFiring::Manual { requested_at },
        }))
    );
}
