use super::*;
use agent_session::domain::routines::{
    PrepareRoutineSession, PreparedRoutineSession, PromptRoutineSession, RoutineActionStatus,
    RoutinePromptAccepted, RoutineSessionAction, RoutineSessionError, ValidatedRoutineSession,
};
use serde_json::json;
use std::sync::Mutex;

pub(crate) const BOT: &str = "01960000-0000-7000-8000-000000000001";
pub(crate) const OWNER: &str = "macro|routine-owner@macro.com";

#[derive(Default)]
pub(crate) struct Sessions {
    pub(crate) validations: Mutex<Vec<ValidateRoutineSession>>,
    pub(crate) preparations: Mutex<Vec<PrepareRoutineSession>>,
    pub(crate) error: Mutex<Option<RoutineSessionError>>,
}

impl RoutineSessions for Sessions {
    async fn validate(
        &self,
        command: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        self.validations.lock().unwrap().push(command.clone());
        if command.owner.as_ref() != OWNER {
            return Err(RoutineSessionError::Forbidden);
        }
        if command.bot_id.to_string() != BOT {
            return Err(RoutineSessionError::PersonaUnavailable);
        }
        if let Some(error) = *self.error.lock().unwrap() {
            return Err(error);
        }
        // External runtime need not be online for its authorized selection to be saved.
        Ok(ValidatedRoutineSession { managed: false })
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        self.preparations.lock().unwrap().push(command.clone());
        self.validate(command.selection).await?;
        Ok(PreparedRoutineSession {
            session_id: command.session_id,
        })
    }

    async fn prompt(
        &self,
        _: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        panic!("configuration validation and denied preparation must never prompt")
    }
    async fn status(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        panic!("configuration validation and denied preparation must never poll")
    }
    async fn cancel(&self, _: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        panic!("configuration validation must never cancel")
    }
}

pub(crate) fn agent_task() -> Value {
    json!({"agent":{"bot_id":BOT}, "prompt":"instructions", "user_prompt":"task"})
}

#[tokio::test]
async fn local_validation_precedes_gate_and_remote_authorization() {
    let sessions = Arc::new(Sessions::default());
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    for enabled in [false, true] {
        let validator = TargetValidation::new(sessions.clone(), enabled);
        for task in [
            json!({}),
            json!({"prompt":"instructions", "user_prompt":"task"}),
            json!({"model":" ", "prompt":"instructions", "user_prompt":"task"}),
            json!({"agent":{"bot_id":"bad-id"}, "prompt":"instructions", "user_prompt":"task"}),
            json!({"agent":{"bot_id":BOT}, "model":"", "prompt":"instructions", "user_prompt":"task"}),
        ] {
            let error = validator.validate_task(&task, &owner).await.unwrap_err();
            assert_eq!(
                error.downcast_ref(),
                Some(&TargetValidationError::InvalidTask)
            );
        }
        validator
            .validate_task(
                &json!({"model":"legacy/model", "prompt":"instructions", "user_prompt":"task"}),
                &owner,
            )
            .await
            .unwrap();
    }
    assert!(sessions.validations.lock().unwrap().is_empty());
}

#[tokio::test]
async fn default_and_disabled_gates_reject_agents_without_contacting_sessions() {
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let sessions = Arc::new(Sessions::default());
    let error = ModelOnlyTargets
        .validate_task(&agent_task(), &owner)
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::AgentsDisabled)
    );
    let error = TargetValidation::new(sessions.clone(), false)
        .validate_task(&agent_task(), &owner)
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref(),
        Some(&TargetValidationError::AgentsDisabled)
    );
    assert!(sessions.validations.lock().unwrap().is_empty());
}

#[tokio::test]
async fn authorizes_owner_and_override_without_starting_external_runtime() {
    let sessions = Arc::new(Sessions::default());
    let validator = TargetValidation::new(sessions.clone(), true);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    for model in [None, Some("external/model")] {
        let mut task = agent_task();
        if let Some(model) = model {
            task["model"] = json!(model);
        }
        validator.validate_task(&task, &owner).await.unwrap();
        let calls = sessions.validations.lock().unwrap();
        let call = calls.last().unwrap();
        assert_eq!(call.owner, owner);
        assert_eq!(call.bot_id.to_string(), BOT);
        assert_eq!(call.model.as_deref(), model);
    }
    let foreign = MacroUserIdStr::parse_from_str("macro|other@macro.com").unwrap();
    let error = validator
        .validate_task(&agent_task(), &foreign)
        .await
        .unwrap_err();
    assert_eq!(error.downcast_ref(), Some(&RoutineSessionError::Forbidden));
    assert!(sessions.preparations.lock().unwrap().is_empty());
}

#[test]
fn requires_explicit_null_to_remove_even_an_unparseable_historical_selection() {
    for previous in [
        agent_task(),
        json!({"agent":{"bot_id":"deleted-legacy-id"}}),
    ] {
        let error = require_explicit_agent(&previous, &json!({"model":"model"})).unwrap_err();
        assert_eq!(
            error.downcast_ref(),
            Some(&TargetValidationError::ExplicitAgentRequired)
        );
        require_explicit_agent(&previous, &json!({"agent":null,"model":"model"})).unwrap();
        require_explicit_agent(&previous, &agent_task()).unwrap();
    }
    require_explicit_agent(&json!({"model":"old"}), &json!({"model":"new"})).unwrap();
}
