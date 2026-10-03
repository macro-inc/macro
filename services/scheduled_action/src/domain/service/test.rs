mod admission;
mod user_cleanup;

use super::*;
use crate::domain::event_runs::ClaimToken;
use crate::domain::models::{
    ActionConfigurationUpdate, ActionKind, ExecutionResource, ExecutionResourceType,
    MAX_ACTION_TIME,
};
use crate::domain::{
    event_trigger::EventReference,
    execution::ExecutionHandle,
    ports::{ScheduledActionReadService, ScheduledAgentRunner},
    read_service::ScheduledActionReadServiceImpl,
    target_runner::TargetRunner,
    target_validation::{
        TargetValidation, TargetValidationError,
        test::{Sessions, agent_task},
    },
};
use agent_session::domain::routines::RoutineSessionError;
use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, EntityAccessReceipt, EntityType, OwnerAccessLevel,
        ViewAccessLevel,
    },
    ports::ScheduledActionGrants,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use macro_uuid::generate_uuid_v7;
use model_owner::{CreationPrincipal, Owner};
use serde_json::json;
use std::sync::Mutex;

pub(crate) const USER: &str = "macro|routine-owner@macro.com";
const FOREIGN_USER: &str = "macro|other@macro.com";

#[derive(Default)]
pub(crate) struct FakeRepo {
    actions: Mutex<Vec<ScheduledAction>>,
}

impl ScheduledActionRepo for FakeRepo {
    async fn create_action(&self, mut action: ScheduledAction) -> Result<ScheduledAction> {
        action.id = Some(generate_uuid_v7());
        self.actions.lock().unwrap().push(action.clone());
        Ok(action)
    }

    async fn get_owned_actions(
        &self,
        _owner: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ScheduledAction>> {
        // Return every stored owner so cleanup can reject a foreign row.
        Ok(self.actions.lock().unwrap().clone())
    }

    async fn get_actions_by_ids(&self, ids: &[Uuid]) -> Result<Vec<ScheduledAction>> {
        Ok(self
            .actions
            .lock()
            .unwrap()
            .iter()
            .filter(|action| action.id.is_some_and(|id| ids.contains(&id)))
            .cloned()
            .collect())
    }

    async fn get_action(&self, id: &Uuid) -> Result<Option<ScheduledAction>> {
        Ok(self
            .actions
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.id == Some(*id))
            .cloned())
    }

    async fn update_action(&self, action: ScheduledAction) -> Result<ScheduledAction> {
        let mut actions = self.actions.lock().unwrap();
        let stored = actions.iter_mut().find(|a| a.id == action.id).unwrap();
        if stored.configuration_revision.next()? != action.configuration_revision {
            return Err(ActionPolicyError::UpdateConflict.into());
        }
        *stored = action.clone();
        Ok(action)
    }

    async fn delete_action(&self, id: &Uuid) -> Result<()> {
        self.actions.lock().unwrap().retain(|a| a.id != Some(*id));
        Ok(())
    }

    async fn get_execution_records(&self, _id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        Ok(vec![])
    }

    async fn get_next_unclaimed_actions(&self, _limit: i64) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn claim_action(
        &self,
        _id: &Uuid,
        _revision: ConfigurationRevision,
    ) -> Result<ClaimToken> {
        unimplemented!()
    }
    async fn release_action(&self, _id: &Uuid, _token: ClaimToken) -> Result<()> {
        unimplemented!()
    }
    async fn create_execution_record(&self, _record: ActionExecutionRecord) -> Result<()> {
        unimplemented!()
    }
    async fn update_next_run_at(&self, _id: &Uuid) -> Result<()> {
        unimplemented!()
    }
    async fn update_last_executed(&self, _id: &Uuid, _at: DateTime<Utc>) -> Result<()> {
        unimplemented!()
    }
}

#[derive(Default)]
pub(crate) struct FakeExecutor {
    calls: Mutex<Vec<ScheduledAction>>,
    admission_error: Mutex<Option<ai_billing::AiAdmissionError>>,
}

pub(crate) fn set_admission_error(service: &TestService, error: ai_billing::AiAdmissionError) {
    *service.executor.admission_error.lock().unwrap() = Some(error);
}

impl ScheduledActionExecutor for FakeExecutor {
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        let action_id = action.id.unwrap();
        self.calls.lock().unwrap().push(action);
        if let Some(error) = *self.admission_error.lock().unwrap() {
            return Err(error.into());
        }
        Ok(InProgressExecution {
            action_id,
            chat_id: Some("manual-chat".into()),
            resource: Some(ExecutionResource {
                resource_type: ExecutionResourceType::Chat,
                id: "manual-chat".into(),
            }),
        })
    }
}

pub(crate) struct FakeGrants {
    repo: Arc<FakeRepo>,
    only: Mutex<Option<Vec<Uuid>>>,
    granted: Mutex<std::collections::HashMap<String, Vec<Uuid>>>,
}

impl FakeGrants {
    pub(crate) fn all(repo: Arc<FakeRepo>) -> Self {
        Self {
            repo,
            only: Mutex::new(None),
            granted: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl ScheduledActionGrants for FakeGrants {
    async fn accessible_scheduled_action_ids(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<Uuid>, AccessError> {
        if user_id.as_ref() != USER {
            return Ok(self
                .granted
                .lock()
                .unwrap()
                .get(user_id.as_ref())
                .cloned()
                .unwrap_or_default());
        }
        if let Some(ids) = self.only.lock().unwrap().clone() {
            return Ok(ids);
        }
        Ok(self
            .repo
            .actions
            .lock()
            .unwrap()
            .iter()
            .filter_map(|action| action.id)
            .collect())
    }
}

pub(crate) fn set_stored_owner(service: &TestService, id: Uuid, owner: Owner) {
    let mut actions = service.repo.actions.lock().unwrap();
    let action = actions
        .iter_mut()
        .find(|action| action.id == Some(id))
        .expect("stored action");
    action.owner = owner;
}

pub(crate) fn grant_to(service: &TestService, user_id: &str, id: Uuid) {
    service
        .grants
        .granted
        .lock()
        .unwrap()
        .entry(user_id.to_owned())
        .or_default()
        .push(id);
}

pub(crate) type TestService = ScheduledActionServiceImpl<FakeRepo, FakeExecutor, FakeGrants>;

fn grants(repo: &Arc<FakeRepo>) -> Arc<FakeGrants> {
    Arc::new(FakeGrants::all(Arc::clone(repo)))
}

pub(crate) fn service(enabled: bool) -> Arc<TestService> {
    let repo = Arc::new(FakeRepo::default());
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    Arc::new(
        TestService::new(
            Arc::clone(&repo),
            Arc::new(FakeExecutor::default()),
            tx,
            grants(&repo),
        )
        .with_event_management_enabled(enabled),
    )
}

fn user_principal() -> CreationPrincipal {
    CreationPrincipal::User(user())
}

fn edit_receipt(id: Uuid) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        &id.to_string(),
        EntityType::ScheduledAction,
    )
}

fn owner_receipt(id: Uuid) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        &id.to_string(),
        EntityType::ScheduledAction,
    )
}

fn view_receipt(id: Uuid) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(),
        &id.to_string(),
        EntityType::ScheduledAction,
    )
}

pub(crate) fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(USER.to_owned()).unwrap()
}

pub(crate) fn configuration(events: bool) -> ActionConfiguration {
    let trigger = if events {
        json!({"type": "events", "filters": [{"events": ["document.created"]}]})
    } else {
        json!({"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"})
    };
    ActionConfiguration {
        name: "routine".into(),
        trigger: serde_json::from_value(trigger).unwrap(),
        kind: ActionKind::Agent,
        task: json!({"model": "model", "prompt": "summarize", "user_prompt": "task"}),
        enabled: true,
    }
}

/// Clients deployed before the activation endpoint send `enabled` with every update.
fn update(config: ActionConfiguration) -> UpdateScheduledAction {
    UpdateScheduledAction::Canonical(ActionConfigurationUpdate {
        name: config.name,
        trigger: config.trigger,
        kind: config.kind,
        task: config.task,
        enabled: Some(config.enabled),
    })
}

#[tokio::test]
async fn validates_before_persistence_and_rejects_cross_owner_selection() {
    let base = service(false);
    let sessions = Arc::new(Sessions::default());
    let svc = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_target_validation(TargetValidation::new(sessions.clone(), true));
    let mut config = configuration(false);
    config.task = agent_task();
    let foreign = MacroUserIdStr::parse_from_str(FOREIGN_USER).unwrap();
    let error = svc
        .create_action(
            &CreationPrincipal::User(foreign),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap_err();
    assert_eq!(error.downcast_ref(), Some(&RoutineSessionError::Forbidden));
    assert!(base.repo.actions.lock().unwrap().is_empty());

    config.task = json!({});
    let error = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::InvalidTask)
    );
    assert!(base.repo.actions.lock().unwrap().is_empty());

    config.task = agent_task();
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let original = created.task;
    *sessions.error.lock().unwrap() = Some(RoutineSessionError::Forbidden);
    config.task["user_prompt"] = json!("replacement");
    let error = svc
        .update_action(edit_receipt(created.id.unwrap()), update(config))
        .await
        .unwrap_err();
    assert_eq!(error.downcast_ref(), Some(&RoutineSessionError::Forbidden));
    let stored = base.repo.actions.lock().unwrap();
    assert_eq!(stored[0].task, original);
    assert_eq!(
        stored[0].configuration_revision,
        ConfigurationRevision::INITIAL
    );
}

#[tokio::test]
async fn gated_acceptance_allows_models_and_explicit_switch_but_rejects_old_clients() {
    let base = service(false);
    let svc = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_target_validation(TargetValidation::new(Arc::new(Sessions::default()), true));
    let mut config = configuration(false);
    config.task = agent_task();
    let error = base
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::AgentsDisabled)
    );
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    let error = base
        .update_action(edit_receipt(id), update(config))
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::AgentsDisabled)
    );

    // An old client cannot erase the agent even when trying to pause it.
    let mut model = configuration(false);
    for enabled in [false, true] {
        model.enabled = enabled;
        let error = base
            .update_action(edit_receipt(id), update(model.clone()))
            .await
            .unwrap_err();
        assert_eq!(
            error.downcast_ref(),
            Some(&TargetValidationError::ExplicitAgentRequired)
        );
        assert_eq!(base.repo.actions.lock().unwrap()[0].task, created.task);
    }
    model.task["agent"] = json!(null);
    let switched = base
        .update_action(edit_receipt(id), update(model.clone()))
        .await
        .unwrap();
    assert_eq!(switched.task, model.task);
    base.create_action(&user_principal(), CreateScheduledAction::Canonical(model))
        .await
        .unwrap();
}

#[tokio::test]
async fn unavailable_agents_can_be_paused_deleted_and_have_history_read_without_validation() {
    for claimed in [false, true] {
        let base = service(false);
        let sessions = Arc::new(Sessions::default());
        let svc = TestService::new(
            base.repo.clone(),
            base.executor.clone(),
            base.dispatcher_tx.clone(),
            grants(&base.repo),
        )
        .with_target_validation(TargetValidation::new(sessions.clone(), true));
        let mut config = configuration(false);
        config.task = agent_task();
        let created = svc
            .create_action(
                &user_principal(),
                CreateScheduledAction::Canonical(config.clone()),
            )
            .await
            .unwrap();
        let id = created.id.unwrap();
        if claimed {
            base.repo.actions.lock().unwrap()[0].claimed = Some(Utc::now());
        }
        *sessions.error.lock().unwrap() = Some(RoutineSessionError::RuntimeUnavailable);
        if !claimed {
            let error = svc
                .update_action(edit_receipt(id), update(config.clone()))
                .await
                .unwrap_err();
            assert_eq!(
                error.downcast_ref(),
                Some(&RoutineSessionError::RuntimeUnavailable)
            );
        }
        let validations = sessions.validations.lock().unwrap().len();
        config.enabled = false;
        let paused = svc
            .update_action(edit_receipt(id), update(config.clone()))
            .await
            .unwrap();
        assert!(!paused.enabled);
        assert_eq!(paused.task, created.task);
        assert_eq!(paused.claimed.is_some(), claimed);
        // Disabling still works if acceptance has since been turned off.
        base.update_action(edit_receipt(id), update(config))
            .await
            .unwrap();
        svc.get_execution_records(view_receipt(id)).await.unwrap();
        svc.delete_action(owner_receipt(id)).await.unwrap();
        assert!(base.repo.actions.lock().unwrap().is_empty());
        assert_eq!(sessions.validations.lock().unwrap().len(), validations);
    }
}

struct NoModelFallback;

impl ScheduledAgentRunner for NoModelFallback {
    async fn prepare(&self, _: &ScheduledAction, _: &mut ExecutionHandle) -> Result<()> {
        panic!("must not fall back")
    }
    async fn run(
        &self,
        _: &ScheduledAction,
        _: &ExecutionHandle,
        _: Option<&EventReference>,
    ) -> Result<()> {
        panic!("must not fall back")
    }
    async fn cancel(&self, _: &ScheduledAction, _: &ExecutionHandle) -> Result<()> {
        panic!("must not fall back")
    }
}

#[tokio::test]
async fn preparation_reauthorizes_previously_saved_selection_after_deletion_or_revocation() {
    for denial in [
        RoutineSessionError::PersonaUnavailable,
        RoutineSessionError::Forbidden,
    ] {
        let base = service(false);
        let sessions = Arc::new(Sessions::default());
        let svc = TestService::new(
            base.repo.clone(),
            base.executor.clone(),
            base.dispatcher_tx.clone(),
            grants(&base.repo),
        )
        .with_target_validation(TargetValidation::new(sessions.clone(), true));
        let mut config = configuration(false);
        config.task = agent_task();
        let created = svc
            .create_action(&user_principal(), CreateScheduledAction::Canonical(config))
            .await
            .unwrap();
        assert!(sessions.preparations.lock().unwrap().is_empty());
        *sessions.error.lock().unwrap() = Some(denial);
        let runner = TargetRunner::new(Arc::new(NoModelFallback), sessions.clone());
        let mut handle = ExecutionHandle::default();
        let error = runner.prepare(&created, &mut handle).await.unwrap_err();
        assert_eq!(error.downcast_ref(), Some(&denial));
        assert!(handle.resource.is_none());
        assert_eq!(sessions.preparations.lock().unwrap().len(), 1);
    }
}

fn assert_policy<T: std::fmt::Debug>(result: Result<T>, expected: ActionPolicyError) {
    assert_eq!(
        result
            .unwrap_err()
            .downcast_ref::<ActionPolicyError>()
            .unwrap()
            .to_string(),
        expected.to_string()
    );
}

#[tokio::test]
async fn creates_both_triggers_with_server_owned_state_and_legacy_input() {
    let svc = service(true);
    for events in [false, true] {
        let before = Utc::now();
        let created = svc
            .create_action(
                &user_principal(),
                CreateScheduledAction::Canonical(configuration(events)),
            )
            .await
            .unwrap();
        assert!(created.owner.is_user(&user()));
        assert!(created.claimed.is_none());
        assert_eq!(
            created.configuration_revision,
            ConfigurationRevision::INITIAL
        );
        assert_eq!(created.next_run_at.is_none(), events);
        assert_eq!(created.event_activated_at.is_some(), events);
        assert!(created.created_at >= before);
    }
    let legacy = serde_json::from_value(json!({
        "name": "legacy", "schedule": "0 0 9 * * *", "timezone": "UTC",
        "kind": "Agent", "task": {"model":"model", "prompt":"instructions", "user_prompt":"task"}, "enabled": true
    }))
    .unwrap();
    assert!(
        svc.create_action(&user_principal(), legacy)
            .await
            .unwrap()
            .next_run_at
            .is_some()
    );
}

#[tokio::test]
async fn default_gate_rejects_event_creation_and_transition_but_allows_cron() {
    let (tx, _rx) = tokio::sync::mpsc::channel(8);
    let repo = Arc::new(FakeRepo::default());
    let svc = TestService::new(
        repo.clone(),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    );
    assert_policy(
        svc.create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(true)),
        )
        .await,
        ActionPolicyError::EventManagementDisabled,
    );
    let cron = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    assert_policy(
        svc.update_action(edit_receipt(cron.id.unwrap()), update(configuration(true)))
            .await,
        ActionPolicyError::EventManagementDisabled,
    );
}

#[tokio::test]
async fn gate_off_rejects_enabling_an_existing_event_action() {
    let enabled = service(true);
    let mut config = configuration(true);
    config.enabled = false;
    let action = enabled
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let disabled = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
        grants(&enabled.repo),
    )
    .with_event_management_enabled(false);
    config.enabled = true;
    assert_policy(
        disabled
            .update_action(edit_receipt(action.id.unwrap()), update(config))
            .await,
        ActionPolicyError::EventManagementDisabled,
    );
    assert!(!enabled.repo.actions.lock().unwrap()[0].enabled);
}

#[tokio::test]
async fn cron_without_future_firings_is_bad_input() {
    let svc = service(true);
    let mut input = configuration(false);
    input.trigger = serde_json::from_value(
        json!({"type":"cron", "schedule":"0 0 0 1 1 * 2000", "timezone":"UTC"}),
    )
    .unwrap();
    assert_policy(
        svc.create_action(&user_principal(), CreateScheduledAction::Canonical(input))
            .await,
        ActionPolicyError::NoFutureFirings,
    );
}

#[tokio::test]
async fn list_is_cron_only_by_default_but_id_operations_reach_events() {
    let svc = service(true);
    let cron = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let event = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(true)),
        )
        .await
        .unwrap();
    assert_eq!(svc.get_actions(user(), false).await.unwrap()[0].id, cron.id);
    assert_eq!(svc.get_actions(user(), false).await.unwrap().len(), 1);
    assert_eq!(svc.get_actions(user(), true).await.unwrap().len(), 2);
    svc.get_execution_records(view_receipt(event.id.unwrap()))
        .await
        .unwrap();
    svc.delete_action(owner_receipt(event.id.unwrap()))
        .await
        .unwrap();
    assert_eq!(svc.get_actions(user(), true).await.unwrap().len(), 1);
}

#[tokio::test]
async fn receipt_manages_another_owners_row_and_missing_row_is_not_found() {
    let svc = service(true);
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    svc.repo.actions.lock().unwrap()[0].owner = Owner::from_principal_str(FOREIGN_USER).unwrap();
    svc.delete_action(owner_receipt(id)).await.unwrap();
    assert!(svc.repo.actions.lock().unwrap().is_empty());
    let error = svc.execute_action_now(owner_receipt(id)).await.unwrap_err();
    assert!(matches!(
        error.downcast_ref(),
        Some(ActionPolicyError::NotFound)
    ));
}

#[tokio::test]
async fn bot_owned_execution_and_validating_update_need_a_user_owner() {
    use crate::domain::target_validation::{
        TargetValidation,
        test::{Sessions, agent_task},
    };
    let base = service(true);
    let sessions = Arc::new(Sessions::default());
    let svc = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_target_validation(TargetValidation::new(sessions.clone(), true));
    let mut config = configuration(false);
    config.task = agent_task();
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    let editor = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(FOREIGN_USER).unwrap(),
        &id.to_string(),
        EntityType::ScheduledAction,
    );
    config.task["prompt"] = json!("changed");
    svc.update_action(editor, update(config.clone()))
        .await
        .unwrap();
    assert_eq!(
        sessions
            .validations
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .owner
            .as_ref(),
        USER
    );

    svc.repo.actions.lock().unwrap()[0].owner = Owner::Bot(bot_id::BotId::TEST_A);
    let before = sessions.validations.lock().unwrap().len();
    let error = svc
        .update_action(edit_receipt(id), update(config.clone()))
        .await
        .unwrap_err();
    assert!(error.downcast_ref::<OwnerNotUserError>().is_some());
    assert_eq!(sessions.validations.lock().unwrap().len(), before);

    let disabled = svc.set_enabled(edit_receipt(id), false).await.unwrap();
    assert!(!disabled.enabled);
    assert_eq!(sessions.validations.lock().unwrap().len(), before);

    let error = svc.execute_action_now(owner_receipt(id)).await.unwrap_err();
    assert!(error.to_string().contains("owner is a bot"));
    assert!(base.executor.calls.lock().unwrap().is_empty());

    svc.repo.actions.lock().unwrap()[0].owner = Owner::User(user());
    svc.execute_action_now(owner_receipt(id)).await.unwrap();
    assert_eq!(base.executor.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn user_and_bot_for_user_record_a_user_and_team_bot_writes_nothing() {
    let svc = service(true);
    let input = CreateScheduledAction::Canonical(configuration(false));
    let as_user = svc
        .create_action(&CreationPrincipal::User(user()), input.clone())
        .await
        .unwrap();
    assert_eq!(as_user.owner, Owner::User(user()));
    let as_bot = svc
        .create_action(
            &CreationPrincipal::BotForUser {
                bot: bot_id::BotId::TEST_A,
                user: user(),
            },
            input.clone(),
        )
        .await
        .unwrap();
    assert_eq!(as_bot.owner, Owner::User(user()));
    let before = svc.repo.actions.lock().unwrap().len();
    let error = svc
        .create_action(
            &CreationPrincipal::TeamBot {
                bot: bot_id::NonSystemBotId::new(bot_id::BotId::TEST_A).unwrap(),
                team: Uuid::from_u128(7),
            },
            input,
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("owner is a bot"));
    assert_eq!(svc.repo.actions.lock().unwrap().len(), before);
}

#[tokio::test]
async fn disabled_manual_runs_work_for_both_variants_even_with_gate_off() {
    let enabled = service(true);
    let svc = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
        grants(&enabled.repo),
    );
    for events in [false, true] {
        let mut config = configuration(events);
        config.enabled = false;
        let action = enabled
            .create_action(&user_principal(), CreateScheduledAction::Canonical(config))
            .await
            .unwrap();
        let id = action.id.unwrap();
        svc.execute_action_now(owner_receipt(id)).await.unwrap();
        let after = svc.repo.get_action(&id).await.unwrap().unwrap();
        assert_eq!(after.configuration_revision, action.configuration_revision);
        assert_eq!(after.event_activated_at, action.event_activated_at);
        assert!(!after.enabled);
    }
    assert_eq!(svc.executor.calls.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn updates_advance_revision_and_only_trigger_changes_or_enabling_reset_activation() {
    let svc = service(true);
    let mut config = configuration(true);
    let action = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let id = action.id.unwrap();
    let past = Utc::now() - chrono::Duration::days(1);
    svc.repo.actions.lock().unwrap()[0].event_activated_at = Some(past);
    config.task["prompt"] = json!("changed");
    let updated = svc
        .update_action(edit_receipt(id), update(config.clone()))
        .await
        .unwrap();
    assert_eq!(updated.configuration_revision.get(), 2);
    assert_eq!(updated.created_at, action.created_at);
    assert_eq!(updated.event_activated_at, Some(past));
    config.enabled = false;
    let disabled = svc
        .update_action(edit_receipt(id), update(config.clone()))
        .await
        .unwrap();
    assert_eq!(disabled.configuration_revision.get(), 3);
    assert_eq!(disabled.event_activated_at, Some(past));
    config.enabled = true;
    let enabled = svc
        .update_action(edit_receipt(id), update(config.clone()))
        .await
        .unwrap();
    assert_eq!(enabled.configuration_revision.get(), 4);
    assert!(enabled.event_activated_at.unwrap() > past);
    svc.repo.actions.lock().unwrap()[0].event_activated_at = Some(past);
    config.trigger = serde_json::from_value(
        json!({"type":"events", "filters":[{"events":["document.updated"]}]}),
    )
    .unwrap();
    let changed = svc
        .update_action(edit_receipt(id), update(config))
        .await
        .unwrap();
    assert!(changed.event_activated_at.unwrap() > past);
    let cron = svc
        .update_action(edit_receipt(id), update(configuration(false)))
        .await
        .unwrap();
    assert!(cron.event_activated_at.is_none());
    assert!(cron.next_run_at.is_some());
}

#[tokio::test]
async fn active_execution_blocks_replacement_but_allows_disabling_even_with_gate_off() {
    let enabled = service(true);
    let mut config = configuration(true);
    let action = enabled
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let id = action.id.unwrap();
    enabled.repo.actions.lock().unwrap()[0].claimed = Some(Utc::now());
    let mut replacement = config.clone();
    replacement.name = "new name".into();
    assert_policy(
        enabled
            .update_action(edit_receipt(id), update(replacement))
            .await,
        ActionPolicyError::UpdateConflict,
    );
    let svc = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
        grants(&enabled.repo),
    );
    assert_policy(
        svc.update_action(edit_receipt(id), update(config.clone()))
            .await,
        ActionPolicyError::EventManagementDisabled,
    );
    config.enabled = false;
    let disabled = svc
        .update_action(edit_receipt(id), update(config))
        .await
        .unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.claimed.is_some());
    assert_eq!(disabled.event_activated_at, action.event_activated_at);
}

#[test]
fn claim_expiry_instant_still_blocks_replacement() {
    let config = configuration(false);
    let claimed = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
        .expect("timestamp")
        .with_timezone(&Utc);
    let mut action = ScheduledAction {
        id: Some(Uuid::from_u128(1)),
        owner: Owner::User(user()),
        name: config.name,
        trigger: config.trigger,
        kind: config.kind,
        created_at: claimed,
        updated_at: claimed,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: config.task,
        claimed: Some(claimed),
        next_run_at: None,
        enabled: true,
    };
    let expires_at = action
        .claim_expires_at()
        .expect("claimed action has an expiry");
    assert_eq!(expires_at, claimed + MAX_ACTION_TIME);
    assert!(super::claim_blocks_replacement(
        &action,
        expires_at - chrono::Duration::nanoseconds(1)
    ));
    assert!(super::claim_blocks_replacement(&action, expires_at));
    assert!(!super::claim_blocks_replacement(
        &action,
        expires_at + chrono::Duration::nanoseconds(1)
    ));
    action.claimed = None;
    assert_eq!(action.claim_expires_at(), None);
    assert!(!super::claim_blocks_replacement(&action, expires_at));
}

#[tokio::test]
async fn expired_claim_allows_configuration_replacement() {
    let svc = service(true);
    let mut config = configuration(false);
    let action = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(config.clone()),
        )
        .await
        .unwrap();
    let id = action.id.unwrap();
    svc.repo.actions.lock().unwrap()[0].claimed =
        Some(Utc::now() - MAX_ACTION_TIME - chrono::Duration::seconds(1));
    config.name = "renamed".into();
    let updated = svc
        .update_action(edit_receipt(id), update(config))
        .await
        .unwrap();
    assert_eq!(updated.name, "renamed");
    assert!(updated.claimed.is_some());
}

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::UNIX_EPOCH + chrono::Duration::seconds(seconds)
}

fn seeded(
    id: u128,
    owner: Owner,
    created_at: DateTime<Utc>,
    events: bool,
    name: &str,
) -> ScheduledAction {
    let config = configuration(events);
    ScheduledAction {
        id: Some(Uuid::from_u128(id)),
        owner,
        name: name.to_owned(),
        trigger: config.trigger,
        kind: config.kind,
        created_at,
        updated_at: created_at,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: config.task,
        claimed: None,
        next_run_at: None,
        enabled: true,
    }
}

#[tokio::test]
async fn activation_changes_are_idempotent_and_keep_configuration() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    let repo = Arc::new(FakeRepo::default());
    let svc = TestService::new(
        repo.clone(),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    );
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    assert!(matches!(rx.try_recv(), Ok(DispatchEvent::Create(_))));

    let unchanged = svc.set_enabled(edit_receipt(id), true).await.unwrap();
    assert_eq!(unchanged.configuration_revision.get(), 1);
    assert_eq!(unchanged.updated_at, created.updated_at);
    assert!(rx.try_recv().is_err());

    let paused = svc.set_enabled(edit_receipt(id), false).await.unwrap();
    let repeated = svc.set_enabled(edit_receipt(id), false).await.unwrap();
    assert!(!repeated.enabled);
    assert_eq!(repeated.configuration_revision.get(), 2);
    assert_eq!(repeated.updated_at, paused.updated_at);
    assert!(matches!(rx.try_recv(), Ok(DispatchEvent::Update(a)) if !a.enabled));
    assert!(rx.try_recv().is_err());

    svc.repo.actions.lock().unwrap()[0].next_run_at = Some(Utc::now() - chrono::Duration::days(1));
    let resumed = svc.set_enabled(edit_receipt(id), true).await.unwrap();
    assert!(resumed.enabled);
    assert_eq!(resumed.configuration_revision.get(), 3);
    assert!(
        resumed.next_run_at.unwrap() > Utc::now(),
        "a firing missed while paused must not run on resume"
    );
    assert!(matches!(rx.try_recv(), Ok(DispatchEvent::Update(a)) if a.enabled));

    for action in [paused, resumed] {
        assert_eq!(action.name, "routine");
        assert_eq!(
            serde_json::to_value(&action.trigger).unwrap(),
            json!({"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"})
        );
        assert_eq!(
            action.task,
            json!({"model": "model", "prompt": "summarize", "user_prompt": "task"})
        );
    }
}

#[tokio::test]
async fn read_service_keeps_both_triggers_for_the_owner_in_stable_order() {
    let early = at(10);
    let later = at(20);
    let repo = Arc::new(FakeRepo::default());
    *repo.actions.lock().unwrap() = vec![
        seeded(9, Owner::User(user()), later, true, "event"),
        seeded(
            1,
            Owner::from_principal_str(FOREIGN_USER).unwrap(),
            early,
            false,
            "foreign",
        ),
        seeded(4, Owner::User(user()), later, false, "first-equal"),
        seeded(2, Owner::User(user()), early, false, "early-cron"),
        seeded(
            6,
            Owner::from_principal_str(&format!("bot|{}", Uuid::from_u128(50))).unwrap(),
            early,
            false,
            "bot",
        ),
        seeded(
            7,
            Owner::from_principal_str(&Uuid::from_u128(77).hyphenated().to_string()).unwrap(),
            early,
            false,
            "team",
        ),
        seeded(5, Owner::User(user()), later, false, "second-equal"),
        seeded(3, Owner::User(user()), later, false, "low-id"),
    ];
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let accessible = Arc::new(FakeGrants::all(repo.clone()));
    *accessible.only.lock().unwrap() = Some(vec![
        Uuid::from_u128(1),
        Uuid::from_u128(2),
        Uuid::from_u128(3),
        Uuid::from_u128(4),
        Uuid::from_u128(5),
        Uuid::from_u128(9),
    ]);
    let svc = TestService::new(
        repo.clone(),
        Arc::new(FakeExecutor::default()),
        tx,
        accessible.clone(),
    );
    let reader = ScheduledActionReadServiceImpl::new(repo.clone(), accessible);

    let expected = vec![
        "foreign",
        "early-cron",
        "low-id",
        "first-equal",
        "second-equal",
        "event",
    ];
    let read = reader.list_accessible(user()).await.unwrap();
    let names = |actions: &[ScheduledAction]| {
        actions
            .iter()
            .map(|action| action.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&read), expected);
    assert!(read.iter().any(|action| action.name == "foreign"));
    assert!(
        read.iter()
            .all(|action| action.name != "bot" && action.name != "team")
    );
    assert!(
        read.iter()
            .any(|action| matches!(action.trigger, ActionTrigger::Cron { .. }))
    );
    assert!(
        read.iter()
            .any(|action| matches!(action.trigger, ActionTrigger::Events { .. }))
    );
    assert_eq!(
        names(&svc.get_actions(user(), true).await.unwrap()),
        expected
    );
    assert_eq!(
        names(&svc.get_actions(user(), false).await.unwrap()),
        vec![
            "foreign",
            "early-cron",
            "low-id",
            "first-equal",
            "second-equal"
        ]
    );
}

#[tokio::test]
async fn gate_off_allows_pausing_an_event_action_but_not_resuming_it() {
    let enabled = service(true);
    let action = enabled
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(true)),
        )
        .await
        .unwrap();
    let id = action.id.unwrap();
    let gated = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
        grants(&enabled.repo),
    );
    let paused = gated.set_enabled(edit_receipt(id), false).await.unwrap();
    assert!(!paused.enabled);
    assert_eq!(paused.event_activated_at, action.event_activated_at);
    assert_policy(
        gated.set_enabled(edit_receipt(id), true).await,
        ActionPolicyError::EventManagementDisabled,
    );
    assert!(!enabled.repo.actions.lock().unwrap()[0].enabled);

    let past = Utc::now() - chrono::Duration::days(1);
    enabled.repo.actions.lock().unwrap()[0].event_activated_at = Some(past);
    let resumed = enabled.set_enabled(edit_receipt(id), true).await.unwrap();
    assert!(
        resumed.event_activated_at.unwrap() > past,
        "events published while paused must not be replayed"
    );
}

#[tokio::test]
async fn running_actions_can_be_paused_but_not_resumed() {
    let svc = service(true);
    let created = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    svc.repo.actions.lock().unwrap()[0].claimed = Some(Utc::now());
    let paused = svc.set_enabled(edit_receipt(id), false).await.unwrap();
    assert!(!paused.enabled);
    assert!(paused.claimed.is_some());
    assert_policy(
        svc.set_enabled(edit_receipt(id), true).await,
        ActionPolicyError::UpdateConflict,
    );
    assert!(!svc.repo.actions.lock().unwrap()[0].enabled);
}

#[tokio::test]
async fn resuming_revalidates_the_stored_agent_but_pausing_does_not() {
    let base = service(false);
    let sessions = Arc::new(Sessions::default());
    let svc = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_target_validation(TargetValidation::new(sessions.clone(), true));
    let mut config = configuration(false);
    config.task = agent_task();
    let created = svc
        .create_action(&user_principal(), CreateScheduledAction::Canonical(config))
        .await
        .unwrap();
    let id = created.id.unwrap();
    *sessions.error.lock().unwrap() = Some(RoutineSessionError::RuntimeUnavailable);
    let validations = sessions.validations.lock().unwrap().len();
    let paused = svc.set_enabled(edit_receipt(id), false).await.unwrap();
    assert_eq!(paused.task, created.task);
    assert_eq!(sessions.validations.lock().unwrap().len(), validations);

    let error = svc.set_enabled(edit_receipt(id), true).await.unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&RoutineSessionError::RuntimeUnavailable)
    );
    assert!(!base.repo.actions.lock().unwrap()[0].enabled);
    *sessions.error.lock().unwrap() = None;
    let resumed = svc.set_enabled(edit_receipt(id), true).await.unwrap();
    assert!(resumed.enabled);
    assert_eq!(resumed.task, created.task);
}

#[tokio::test]
async fn configuration_updates_that_omit_activation_keep_it() {
    let svc = service(true);
    let id = svc
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap()
        .id
        .unwrap();
    for enabled in [false, true] {
        svc.set_enabled(edit_receipt(id), enabled).await.unwrap();
        let input = serde_json::from_value(json!({
            "name": format!("renamed while enabled={enabled}"),
            "kind": "Agent",
            "trigger": {"type": "cron", "schedule": "0 0 18 * * *", "timezone": "UTC"},
            "task": {"model": "model", "prompt": "summarize", "user_prompt": "task"},
        }))
        .unwrap();
        let updated = svc.update_action(edit_receipt(id), input).await.unwrap();
        assert_eq!(updated.enabled, enabled);
        assert_eq!(updated.name, format!("renamed while enabled={enabled}"));
    }
}
