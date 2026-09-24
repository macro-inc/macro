mod user_cleanup;

use super::*;
use crate::domain::event_runs::ClaimToken;
use crate::domain::models::ActionKind;
use macro_uuid::generate_uuid_v7;
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

    async fn get_actions(&self, _user: MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        // Deliberately return all owners to exercise the service's owner check.
        Ok(self.actions.lock().unwrap().clone())
    }

    async fn get_action(
        &self,
        id: &Uuid,
        _user: MacroUserIdStr<'static>,
    ) -> Result<Option<ScheduledAction>> {
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

    async fn delete_action(&self, id: &Uuid, _user: MacroUserIdStr<'static>) -> Result<()> {
        self.actions.lock().unwrap().retain(|a| a.id != Some(*id));
        Ok(())
    }

    async fn get_execution_records(&self, _id: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        Ok(vec![])
    }

    async fn get_next_unclaimed_actions(&self, _limit: i64) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn claim_action(&self, _id: &Uuid) -> Result<ClaimToken> {
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
}

impl ScheduledActionExecutor for FakeExecutor {
    async fn execute_action(&self, action: ScheduledAction) -> Result<InProgressExecution> {
        let action_id = action.id.unwrap();
        self.calls.lock().unwrap().push(action);
        Ok(InProgressExecution {
            action_id,
            chat_id: Some("manual-chat".into()),
        })
    }
}

pub(crate) type TestService = ScheduledActionServiceImpl<FakeRepo, FakeExecutor>;

pub(crate) fn service(enabled: bool) -> Arc<TestService> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    Arc::new(
        TestService::new(
            Arc::new(FakeRepo::default()),
            Arc::new(FakeExecutor::default()),
            tx,
        )
        .with_event_management_enabled(enabled),
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
        task: json!({"prompt": "summarize"}),
        enabled: true,
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
                CreateScheduledAction::Canonical(configuration(events)),
                user(),
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
        "kind": "Agent", "task": {}, "enabled": true
    }))
    .unwrap();
    assert!(
        svc.create_action(legacy, user())
            .await
            .unwrap()
            .next_run_at
            .is_some()
    );
}

#[tokio::test]
async fn default_gate_rejects_event_creation_and_transition_but_allows_cron() {
    let (tx, _rx) = tokio::sync::mpsc::channel(8);
    let svc = TestService::new(
        Arc::new(FakeRepo::default()),
        Arc::new(FakeExecutor::default()),
        tx,
    );
    assert_policy(
        svc.create_action(
            CreateScheduledAction::Canonical(configuration(true)),
            user(),
        )
        .await,
        ActionPolicyError::EventManagementDisabled,
    );
    let cron = svc
        .create_action(
            CreateScheduledAction::Canonical(configuration(false)),
            user(),
        )
        .await
        .unwrap();
    assert_policy(
        svc.update_action(
            &cron.id.unwrap(),
            UpdateScheduledAction::Canonical(configuration(true)),
            user(),
        )
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
        .create_action(CreateScheduledAction::Canonical(config.clone()), user())
        .await
        .unwrap();
    let disabled = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
    )
    .with_event_management_enabled(false);
    config.enabled = true;
    assert_policy(
        disabled
            .update_action(
                &action.id.unwrap(),
                UpdateScheduledAction::Canonical(config),
                user(),
            )
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
        svc.create_action(CreateScheduledAction::Canonical(input), user())
            .await,
        ActionPolicyError::NoFutureFirings,
    );
}

#[tokio::test]
async fn list_is_cron_only_by_default_but_id_operations_reach_events() {
    let svc = service(true);
    let cron = svc
        .create_action(
            CreateScheduledAction::Canonical(configuration(false)),
            user(),
        )
        .await
        .unwrap();
    let event = svc
        .create_action(
            CreateScheduledAction::Canonical(configuration(true)),
            user(),
        )
        .await
        .unwrap();
    assert_eq!(svc.get_actions(user(), false).await.unwrap()[0].id, cron.id);
    assert_eq!(svc.get_actions(user(), false).await.unwrap().len(), 1);
    assert_eq!(svc.get_actions(user(), true).await.unwrap().len(), 2);
    svc.get_execution_records(&event.id.unwrap(), user())
        .await
        .unwrap();
    svc.delete_action(&event.id.unwrap(), user()).await.unwrap();
    assert_eq!(svc.get_actions(user(), true).await.unwrap().len(), 1);
}

#[tokio::test]
async fn foreign_and_non_user_owners_cannot_be_managed_or_executed() {
    let svc = service(true);
    for owner in [
        Owner::from_principal_str(FOREIGN_USER).unwrap(),
        Owner::from_principal_str(&format!("bot|{}", generate_uuid_v7())).unwrap(),
        Owner::from_principal_str(&generate_uuid_v7().to_string()).unwrap(),
    ] {
        let created = svc
            .create_action(
                CreateScheduledAction::Canonical(configuration(true)),
                user(),
            )
            .await
            .unwrap();
        let id = created.id.unwrap();
        svc.repo.actions.lock().unwrap().last_mut().unwrap().owner = owner;
        assert_policy(
            svc.update_action(
                &id,
                UpdateScheduledAction::Canonical(configuration(true)),
                user(),
            )
            .await,
            ActionPolicyError::NotFound,
        );
        assert_policy(
            svc.delete_action(&id, user()).await,
            ActionPolicyError::NotFound,
        );
        assert_policy(
            svc.get_execution_records(&id, user()).await,
            ActionPolicyError::NotFound,
        );
        assert_policy(
            svc.execute_action_now(&id, user()).await,
            ActionPolicyError::NotFound,
        );
    }
    assert!(svc.get_actions(user(), true).await.unwrap().is_empty());
    assert!(svc.executor.calls.lock().unwrap().is_empty());
    assert_policy(
        svc.execute_action_now(&generate_uuid_v7(), user()).await,
        ActionPolicyError::NotFound,
    );
}

#[tokio::test]
async fn disabled_manual_runs_work_for_both_variants_even_with_gate_off() {
    let enabled = service(true);
    let svc = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
    );
    for events in [false, true] {
        let mut config = configuration(events);
        config.enabled = false;
        let action = enabled
            .create_action(CreateScheduledAction::Canonical(config), user())
            .await
            .unwrap();
        let id = action.id.unwrap();
        svc.execute_action_now(&id, user()).await.unwrap();
        let after = svc.owned_action(&id, &user()).await.unwrap();
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
        .create_action(CreateScheduledAction::Canonical(config.clone()), user())
        .await
        .unwrap();
    let id = action.id.unwrap();
    let past = Utc::now() - chrono::Duration::days(1);
    svc.repo.actions.lock().unwrap()[0].event_activated_at = Some(past);
    config.task = json!({"prompt": "changed"});
    let updated = svc
        .update_action(
            &id,
            UpdateScheduledAction::Canonical(config.clone()),
            user(),
        )
        .await
        .unwrap();
    assert_eq!(updated.configuration_revision.get(), 2);
    assert_eq!(updated.created_at, action.created_at);
    assert_eq!(updated.event_activated_at, Some(past));
    config.enabled = false;
    let disabled = svc
        .update_action(
            &id,
            UpdateScheduledAction::Canonical(config.clone()),
            user(),
        )
        .await
        .unwrap();
    assert_eq!(disabled.configuration_revision.get(), 3);
    assert_eq!(disabled.event_activated_at, Some(past));
    config.enabled = true;
    let enabled = svc
        .update_action(
            &id,
            UpdateScheduledAction::Canonical(config.clone()),
            user(),
        )
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
        .update_action(&id, UpdateScheduledAction::Canonical(config), user())
        .await
        .unwrap();
    assert!(changed.event_activated_at.unwrap() > past);
    let cron = svc
        .update_action(
            &id,
            UpdateScheduledAction::Canonical(configuration(false)),
            user(),
        )
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
        .create_action(CreateScheduledAction::Canonical(config.clone()), user())
        .await
        .unwrap();
    let id = action.id.unwrap();
    enabled.repo.actions.lock().unwrap()[0].claimed = Some(Utc::now());
    let mut replacement = config.clone();
    replacement.name = "new name".into();
    assert_policy(
        enabled
            .update_action(&id, UpdateScheduledAction::Canonical(replacement), user())
            .await,
        ActionPolicyError::UpdateConflict,
    );
    let svc = TestService::new(
        enabled.repo.clone(),
        enabled.executor.clone(),
        enabled.dispatcher_tx.clone(),
    );
    assert_policy(
        svc.update_action(
            &id,
            UpdateScheduledAction::Canonical(config.clone()),
            user(),
        )
        .await,
        ActionPolicyError::EventManagementDisabled,
    );
    config.enabled = false;
    let disabled = svc
        .update_action(&id, UpdateScheduledAction::Canonical(config), user())
        .await
        .unwrap();
    assert!(!disabled.enabled);
    assert!(disabled.claimed.is_some());
    assert_eq!(disabled.event_activated_at, action.event_activated_at);
}
